var inherits = require('util').inherits;
var request = require('request');
var json5 = require('json5');
var fs = require('fs');
var path = require('path');
var watch = require('node-watch');
var async = require('async');

try {
  var uuid = require('hap-nodejs').uuid;
} catch (error) {
  var uuid = null;
}
try {
  var alsa = require('alsa-monitor');
} catch (error) {
  var alsa = null;
}
try {
  var loudness = require('loudness');
} catch (error) {
  var loudness = null;
}

var Service, Characteristic, UUIDgen;
var devices = [];

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDgen = homebridge.hap.uuid;

  homebridge.registerAccessory("homebridge-fidelio", "Fidelio", FidelioAccessory);
};


//
// Fidelio Accessory
//
class FidelioAccessory {

  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.speaker = new FidelioSpeaker(log, config);


    // Set device information
    this.informationService = new Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, "Philips")
      .setCharacteristic(Characteristic.Model, "Fidelio");

    // Add homekit Switch service
    this.service = new Service.SmartSpeaker(config.name);

    this.service.getCharacteristic(Characteristic.CurrentMediaState)
      .on('get', this.getCurrentMediaState.bind(this));

    this.service.getCharacteristic(Characteristic.TargetMediaState)
      .onGet(this.getTargetMediaState.bind(this))
      .on('set', this.setTargetMediaState.bind(this));

    this.targetMediaState = Characteristic.TargetMediaState.STOP;


    this.service
      .addCharacteristic(Characteristic.Volume)
      .on('get', this.getVolume.bind(this))
      .on('set', this.setVolume.bind(this));

    /*
        // Optionally add channel Characteristic
        this.channels = config.channels || false;

        if (this.channels) {
          // Make channel-n Characteristic
          channelCharacteristic = makeChannelCharacteristic(this.channels.length);

          // Add Characteristic to service
          this.service
          .addCharacteristic(channelCharacteristic)
          .on('get', this.getChannel.bind(this))
          .on('set', this.setChannel.bind(this));
        }

    */

    this.log.debug("Added speaker: %s, host: %s", config.name, config.host);

  }

  getServices() {
    return [this.informationService, this.service];
  };


  getCurrentMediaState(callback) {
    this.speaker.getPower(function(error, result) {
      if (error) {
        this.log.debug('Error: getCurrentMediaState() failed: %s', error.message);
      } else {
        this.log.debug('Power is currently %d', result);
      }

      if (result) {
        return callback(error, Characteristic.CurrentMediaState.PLAY);
      } else {
        return callback(error, Characteristic.CurrentMediaState.STOP);

      }
    }.bind(this));
  }


  setTargetMediaState(targetstate, callback) {
    var state = {
      power: !targetstate
    };
    this.targetMediaState = targetstate;

    this.speaker.setState(state, function(error) {
      if (error) {
        this.log.debug('Error: setTargetMediaState failed: %s', error.message);
      } else {
        this.log.debug('TargetMediaState is set to %d', targetstate);
        this.service.getCharacteristic(Characteristic.CurrentMediaState)
          .updateValue(targetstate);
      }
      return callback(error);
    }.bind(this));
  }

  getTargetMediaState() {
    return this.targetMediaState;
  }


  setVolume(volume, callback) {
    var state = {
      volume: volume
    };
    this._setState(state, function(error) {
      if (error) {
        this.log.debug('Error: setVolume failed: %s', error.message);
      } else {
        this.log.debug('Volume is set to %d', volume);
      }
      return callback(error);
    }.bind(this));
  }

  getVolume(callback) {
    return this.speaker.getVolume(callback);
  }

};




class FidelioSpeaker {

  constructor(log, config) {
    this.log = log;
    this.url = 'http://' + config.host + ':8889/';;


    // Optionally listen for JSON file
    this.file = config.file || false;

    if (this.file) {
      try {
        this._initWatch(this.file);
      } catch (err) {
        this.log.debug('Error: failed to init file watcher: %s', err.message);
        this.channelfile = false;
      }
    }

    // Optionally initiate alsa part
    this.alsa = config.alsa || false;
    if (this.alsa) {
      this._initAlsa();
    }


    // initiate cache settings
    if (!config.cache) {
      config.cache = false;
    }
    this.cache = {
      on: config.cache.on || false,
      volume: config.cache.volume || 10,
      volumeNeedsUpdate: false,
      channel: config.cache.channel || 1,
      channelNeedsUpdate: false
    };


  }


  // Control the state of the speaker
  setState(state, callback) {
    // if no power state is given, get current state first
    if (isNaN(state.power)) {
      this.getPower(function(error, result) {
        // we ignore errors, since we always have cached values
        state.power = result + 2;
        // now recurse into ourselves with the polled power state
        this.setState(state, callback);
      }.bind(this));
      return;
    }

    // if alsa volume is required get it first
    if (state.volume == 'alsa') {
      this._getAlsa(function(error, vol) {
        if (error) {
          return callback(error);
        }
        state.volume = vol;
        // now recurse into ourselves with the polled volume
        this._setState(state, callback);
      }.bind(this));
      return;
    }

    // if (needs) to be switched off, store values in cache
    if (state.power === 0 || state.power === false || state.power == 2) {
      if (!isNaN(state.volume)) {
        this.cache.volume = state.volume;
        this.cache.volumeNeedsUpdate = true;
      }
      if (!isNaN(state.channel)) {
        this.cache.channel = state.channel;
        this.cache.channelNeedsUpdate = true;
      }

      // and switch off
      if (state.power === 0 || state.power === false) {
        this.getPower(function(error, result) {
          if (error === null && result == 1) {
            // apparently I'm switched on, so switch me off;
            this._request(this.url + 'CTRL$STANDBY', function(error, result) {
              if (!error) {
                this.cache.on = 0;
              }
              callback(error);
            }.bind(this));
            return;
          }
          callback(error);
        }.bind(this));
      } else {
        //I'm already switched off, nothing to do
        callback(null);
      }
      // we're switched off, so we're done
      return;
    }

    // jeah we're on or need to be on :)
    // is it just a power on request? No other state changes?
    if (isNaN(state.channel) && isNaN(state.volume) && !this.cache.volumeNeedsUpdate && !this.cache.channelNeedsUpdate) {
      // switch me on by calling index
      var url = this.url + 'index';
      request(url, function(error, result) {
        if (!error) {
          this.cache.on = 1;
        }
        callback(error);
      }.bind(this));
      // we're switched on, so we're done
      return;
    }

    //now finally, set state & volume, if applicable
    async.parallel([
        // If needed, set channel
        function(callback) {
          channel = state.channel || (this.cache.channelNeedsUpdate ? this.cache.channel : false);
          if (!channel) {
            return callback(null);
          }
          this._doChannelRequest(channel, callback);
        }.bind(this),

        // If needed, set volume
        function(callback) {
          if (isNaN(state.volume) && !this.cache.volumeNeedsUpdate) {
            //nothing to do
            return callback(null);
          }
          volume = (!isNaN(state.volume)) ? state.volume : this.cache.volume;
          this._doVolumeRequest(volume, callback);
        }.bind(this)
      ],
      callback);
  };

  _initAlsa() {
    if (alsa === null) {
      this.log.debug('Warning: Module `alsa-monitor` is not found, disabling alsa');
      this.alsa = false;
      return;
    }
    if (loudness === null) {
      this.log.debug('Warning: Module `loudness` is not found, disabling alsa');
      this.alsa = false;
      return;
    }
    alsa.volume.on("change", function() {
      var state = {
        volume: 'alsa'
      };
      this._setState(state, function(error) {
        if (error) {
          this.log.debug("Failed to set alsa state: %s", error.message);
        }
      }.bind(this));
    }.bind(this));
  };

  // if alsa state changes, run following callback
  _getAlsa(callback) {
    //check if alsa is active
    if (!this.alsa) {
      return callback(new Error('Alsa not configured'));
    }

    //check for mute first, then for volume
    loudness.getMuted(function(error, muted) {
      if (muted === true) {
        // If I'm muted set volume to 0
        return callback(null, 0);
      } else {
        loudness.getVolume(function(error, vol) {
          if (typeof vol == "number" && !isNaN(vol)) {
            // I got a volume, so proceed
            return callback(null, vol);
          } else {
            return callback(error);
          }
        }.bind(this));
      }
    }.bind(this));
  };



  _initWatch(filename) {
    // We want to watch the whole path, in case the file does not (yet) exist
    watch(path.dirname(filename), function(file) {

      // Check if we're triggerd for the correct file
      if (filename == file) {

        // Try to open file
        fs.readFile(filename, 'utf8', function(err, data) {
          if (err) {
            this.log.debug("Error: error reading file: %s", err);
          }
          try {
            var state = json5.parse(data);
            this._setState(state, function(error) {
              if (error) {
                this.log.debug("Error: file state could not be executed: %s", error.message);
              }
            }.bind(this));
          } catch (error) {
            this.log.debug("Error: file %s could not be parsed: %s", file, error.message);
          }
        }.bind(this));
      }
    }.bind(this));
  };


  _request(url, callback) {
    request(url, function(error, response, body) {
      if (error) {
        callback(error);
        return;
      }
      if (response.statusCode != 200) {
        callback(new Error("Invalid HTTP statusCode: " + response.statusCode));
        return;
      }
      callback(error, body);
    });
  };



  _doChannelRequest(channel, callback) {
    if (!this.channels || channel <= 0 || channel > this.channels.length) {
      return callback(new Error('Channels not configured or out of bounds'));
    }
    this.log.debug("Channel: %s (%d)", this.channels[channel - 1], channel);
    this._request(this.url + this.channels[channel - 1], function(error, result) {
      if (!error) {
        this.cache.on = 1;
        this.cache.channel = channel;
        this.cache.channelNeedsUpdate = false;
      }
      callback(error);
    }.bind(this));
  };

  _doVolumeRequest(volume, callback) {
    if (!(volume >= 0 && volume <= 100)) {
      return callback(new Error('Volume out of bounds'));
    }
    volume = Math.round(volume / 100.0 * 64.0);
    this._request(this.url + 'VOLUME$VAL$' + volume, function(error, result) {
      if (!error) {
        this.cache.on = 1;
        this.cache.volume = volume;
        this.cache.volumeNeedsUpdate = false;
      }
      callback(error);
    }.bind(this));
  };

  getPower(callback) {
    var url = this.url + 'HOMESTATUS';
    this._request(url, function(error, result) {
      if (error) {
        return callback(error, this.cache.on);
      }
      var obj = json5.parse(result);
      if (obj.command == 'STANDBY') {
        var powerOn = !obj.value;
        this.cache.on = powerOn;
        return callback(null, powerOn);
      } else {
        return callback(new Error("Invalid HOMESTATUS response: " + result), this.cache.on);
      }
    }.bind(this));
  };

  getVolume(callback) {
    var url = this.url + 'ELAPSE';
    this._request(url, function(error, result) {
      if (error) {
        this.log.debug('Error: getVolume() failed: %s', error.message);
        return callback(error, this.cache.volume);
      }

      var obj = json5.parse(result);

      if (obj.command == 'ELAPSE') {
        var vol = Math.round(obj.volume / 64.0 * 100.0);
        this.log.debug('Got current volume: %d%% (%d)', vol, obj.volume);
        this.cache.volume = vol;
        return callback(null, vol);

      } else if (obj.command == 'NOTHING') {
        this.log.debug('Returned volume from cache: %d', this.cache.volume);
        return callback(null, this.cache.volume);

      } else {
        var err = "Unknown ELAPSE response: " + result;
        return callback(new Error(err));
      }
    }.bind(this));
  }

}






/*

    FidelioAccessory.prototype.getMute = function(callback) {
      this.getVolume(function(error, vol) {
        return callback(error, (vol==0?true:false));
      });
    };

    FidelioAccessory.prototype.setMute = function(callback, value, context) {

    };



    FidelioAccessory.prototype.getChannel = function(callback) {
      // Currently I don't know a way to query this information from the speakers,
      // so using cache instead.

      this.log('Getting channel from cache: %d', this.cache.channel);
      callback(null, this.cache.channel);
    };


    FidelioAccessory.prototype.setChannel = function(channel, callback) {
      var state = { power: true, channel: channel };
      this._setState(state, function(error){
        if (error) {
          this.log('Error: setChannel failed: %s', error.message);
        } else {
          this.log('Channel is set to %d', channel);
        }
        return callback(error);
      }.bind(this));
    };

*/
//
// Custom Characteristic for Volume

function makeChannelCharacteristic(count) {
  var id = UUIDgen.generate('Channel-' + count);

  channelCharacteristic = function() {
    Characteristic.call(this, 'Channel', id);
    this.setProps({
      format: Characteristic.Formats.INT,
      maxValue: count,
      minValue: 1,
      minStep: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };

  inherits(channelCharacteristic, Characteristic);

  return channelCharacteristic;

}
