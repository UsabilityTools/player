module.exports = (function() {

    var requestAnimationFrame = require('request-animation-frame').requestAnimationFrame;
    var cancelAnimationFrame = require('request-animation-frame').cancelAnimationFrame;
    var extend = require('extend');
    var EventEmitter = require('events').EventEmitter;
    var util = require('util');


    function Player(keyframes, drawer) {
        if(!keyframes || !Array.isArray(keyframes)) {
            throw new Error('keyframes must be an array');
        }
        
        if(!drawer || ('function' !== typeof drawer)) {
            throw new Error('drawer must be a function');
        }
        
        this._keyframes = keyframes.sort(function(a, b) {
            return (a.time - b.time);
        });

        this._drawer = drawer;

        this._frame = this._frame.bind(this);

        this._speed = 1;
        this._desiredFrameRate = 60;
        this._maxFrameTime = (1000 / this._desiredFrameRate * 2);
        this._lastRecordingTime = -1;
        this._averageFrameDuration =  this._toUs(1000 / this._desiredFrameRate);
        this._framesCount = 0;
        this._lastFrameTime = 0;

        this._destroyed = false;

        this._direction = this.directions.FORWARD;
        this._seekingMode = this.seeking.OMIT_FRAMES;
        this._seekingSpeed = 100;

        Object.defineProperties(this, {
            speed: this._createSpeedProperty({
                publicName: 'speed',
                privateName: '_speed'
            }),
            seekingSpeed: this._createSpeedProperty({
                publicName: 'seekingSpeed',
                privateName: '_seekingSpeed'
            }),
            seekingMode: this._createSettingProperty({
                publicName: 'seekingMode',
                privateName: '_seekingMode',
                enumName: 'seeking'
            })
        });
    }

    util.inherits(Player, EventEmitter);

    extend(Player.prototype, {
        seeking: {
            PLAY_FRAMES: 1,
            OMIT_FRAMES: 2
        },
        directions: {
            FORWARD: 1,
            BACKWARD: 2
        },
        destroy: function() {
            if(this._destroyed) {
                throw new Error('instance was destroyed and it is useless now');
            }

            this.stop();
            this.removeAllListeners();

            delete this._keyframes;
            delete this._drawer;
            delete this._frame;

            this._destroyed = true;
        },
        /* @function play - start playing of the recording or resume it when it's paused
         * @param {number} [fromTime=0] - a positive integer, time in milliseconds, starting point of playing
         * @param {*} [direction=directions.FORWARD] - direction of playing
         *
         * @property {object} directions - map of possible directions of playing
         * @property {object} directions.FORWARD - indicates playing from the first to the last frame
         * @property {object} directions.BACKWARD - indicates playing from the last to the first frame
         */
        play: function(fromTime, direction) {
            if(this._destroyed) {
                throw new Error('instance was destroyed and it is useless now');
            }

            if('undefined' !== typeof direction) {
                if(direction === this.directions.FORWARD) {
                    this._direction = this.directions.FORWARD;
                } else if(direction === this.directions.BACKWARD) {
                    this._direction = this.directions.BACKWARD;
                } else {
                    throw new TypeError('direction must be value form "directions" ENUM');
                }
            }

            if(!this._isPlaying || ('undefined' !== typeof fromTime)) {
                this._isPaused = false;
                this._isPlaying = true;

                this._recordingStartTime = this._toUs(fromTime) ||
                    (this._direction === this.directions.FORWARD ? 0 : this._toUs(this._keyframes[this._keyframes.length - 1].time));
                this._lastRecordingTime = this._recordingStartTime;
                this._playingStartTime = 0;

                this._lastFrameTime = 0;
                this._nextFrameDesiredTime = 0;

                this._requestedFrame = requestAnimationFrame(this._frame);
            } else if(this._isPaused) {
                this._isPaused = false;
                
                this._lastFrameTime = 0;
                this._nextFrameDesiredTime = 0;
                
                this._requestedFrame = requestAnimationFrame(this._frame);
            }
        },
        pause: function() {
            if(this._destroyed) {
                throw new Error('instance was destroyed and it is useless now');
            }

            if(this._isPlaying && !this._isPaused) {
                this._isPaused = true;
            }
        },
        stop: function() {
            if(this._destroyed) {
                throw new Error('instance was destroyed and it is useless now');
            }

            if(this._isPlaying) {
                this._isPlaying = false;
                this._isPaused = false;
                
                cancelAnimationFrame(this._requestedFrame);
            }
        },
        /* @function seek - Allows to move video to specified time
         * @param {number} toTime - A positive integer, time in milliseconds, desired recording time
         *
         * @property {object} seeking - map of available modes of seeking
         * @property {object} seeking.PLAY_FRAMES - indicates seeking with playing all frames between current and desired time
         * @property {object} seeking.OMIT_FRAMES - indicates seeking without playing frames between current and desired time
         *
         * @property {*} [seekingMode=seeking.OMIT_FRAMES] - current seeking mode
         * @property {number} [seekingSpeed=100] - indicates speed of playing speed in PLAY_FRAMES mode
         * 
         */
        seek: function(toTime) {
            if(this._destroyed) {
                throw new Error('instance was destroyed and it is useless now');
            }

            if(this._isPlaying) {
                if(this._seekingMode === this.seeking.PLAY_FRAMES) {
                    
                } else {
                    this._lastRecordingTime = this._toUs(toTime);
                }
            }
        },
        _frame: function(ct) {
            var currentTime = this._toUs(ct);
            
            if(!this._lastFrameTime) {
                // the first keyframe is empty
                this._lastFrameTime = currentTime;

                this._nextFrameDesiredTime = currentTime + this._averageFrameDuration;

                this._requestedFrame = requestAnimationFrame(this._frame);
            } else {
                var toForward = (this._direction === this.directions.FORWARD);

                // emit start signal on first "real" keyframe
                if(!this._playingStartTime) {
                    this.emit('start', this._toMs(this._playingStartTime = currentTime));
                }
                
                var lastFrameDuration = currentTime - this._lastFrameTime;
                this._framesCount++;
                this._averageFrameDuration += (lastFrameDuration - this._averageFrameDuration) / this._framesCount;

                var frameStartTime = this._nextFrameDesiredTime;
                var frameDuration = Math.max(currentTime - frameStartTime, Math.round(this._averageFrameDuration));

                var startKeyframeTime = this._lastRecordingTime;
                var endKeyframeTime = startKeyframeTime + (this._adaptToSpeed(frameDuration) * (toForward ? 1 : -1));
                
                this._nextFrameDesiredTime = currentTime + frameDuration;
                this._lastFrameTime = currentTime;
                this._lastRecordingTime = endKeyframeTime;

                var keyframes = this._getKeyframesForTimeRange(startKeyframeTime, endKeyframeTime, toForward);
                var lastIndex = this._keyframes.indexOf(keyframes[keyframes.length - 1]);
                var nextKeyframe = this._keyframes[lastIndex + (toForward ? 1 : -1)];

                this._drawer(keyframes, nextKeyframe, this._toMs(currentTime));
                
                if(keyframes[keyframes.length - 1] !== this._keyframes[(toForward ? this._keyframes.length - 1 : 0)]) {
                    if(!this._isPaused) {
                        this._requestedFrame = requestAnimationFrame(this._frame);
                    } else {
                        this.emit('pause');
                    }
                } else {
                    this.emit('end');
                }
            }
        },
        _getKeyframesForTimeRange: function(st, et, toForward) {
            var startTime = this._toMs(st);
            var endTime = this._toMs(et);
            
            if(toForward) {
                return this._keyframes.filter(function(keyframe) {
                    return (keyframe.time >= startTime) && (keyframe.time < endTime);
                });
            } else {
                return this._keyframes.filter(function(keyframe) {
                    return (keyframe.time > endTime) && (keyframe.time <= startTime);
                }).reverse();
            }
        },
        _adaptToSpeed: function(value) {
            return Math.round(value * this._speed, 10);
        },
        _toUs: function(milliseconds) {
            return parseInt(milliseconds * 10e2, 10);
        },
        _toMs: function(microseconds) {
            return parseFloat((microseconds / 10e2).toFixed(3), 10);
        },
        _createSpeedProperty: function(conf) {
            return {
                get: function() {
                    return this[conf.privateName];
                },
                set: function(value) {
                    var parsed = parseFloat(value, 10);

                    if(!isNaN(parsed)) {
                        this[conf.privateName] = parsed;

                        return parsed;
                    } else {
                        throw new TypeError(conf.publicName + ' must be a number');
                    }
                }
            };
        },
        _createSettingProperty: function(conf) {
            var enumValues = Object.keys(this[conf.enumName]).map(function(key) {
                return this[conf.enumName][key];
            }, this);

            return {
                get: function() {
                    return this[conf.privateName];
                },
                set: function(value) {
                    if(enumValues.indexOf(value) !== -1) {
                        this[conf.privateName] = value;

                        return value;
                    } else {
                        throw new TypeError(conf.publicName + ' must have value from "' + conf.enumName + '" ENUM');
                    }
                }
            };
        }
    });


    return Player;

})();