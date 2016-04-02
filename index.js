var inherits = require('util').inherits;
var request = require('request');
var json5 = require('json5');
var fs = require('fs');
var path = require('path');
var watch = require('node-watch');

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



var Service, Characteristic, VolumeCharacteristic;
var devices = [];

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  // we can only do this after we receive the homebridge API object
  makeVolumeCharacteristic();

  homebridge.registerAccessory("homebridge-fidelio", "Fidelio", FidelioAccessory);
};



//
// Fidelio Accessory
//

function FidelioAccessory(log, config) {
  this.log = log;
  this.config = config;
  this.name = config.name;
  this.host = config.host;
  this.url = 'http://' + this.host + ':8889/';

  // Set device information
  this.informationService = new Service.AccessoryInformation();

  this.informationService
    .setCharacteristic(Characteristic.Manufacturer, "Philips")
    .setCharacteristic(Characteristic.Model, "Fidelio");

  // Add homekit Switch service
  this.switchService = new Service.Switch(this.name + ' Power');

  this.switchService
  .getCharacteristic(Characteristic.On)
  .on('get', this.getOn.bind(this))
  .on('set', this.setOn.bind(this));

  this.switchService
  .addCharacteristic(VolumeCharacteristic)
  .on('get', this.getVolume.bind(this))
  .on('set', this.setVolume.bind(this));

  // Optionally add channel Characteristic
  this.channels = config.channels || false;

  if (this.channels) {
    // Make channel-n Characteristic
    channelCharacteristic = makeChannelCharacteristic(this.channels.length);

    // Add Characteristic to switchService
    this.switchService
      .addCharacteristic(channelCharacteristic)
      .on('get', this.getChannel.bind(this))
      .on('set', this.setChannel.bind(this));
  }

  // Optionally listen for JSON file
  this.file = config.file || false;

  if(this.file) {
    try {
      this._initWatch(this.file);
    } catch (err) {
      this.log('Error: failed to init file watcher: %s', err.message);
      this.channelfile = false;
    }
  }

  // Optionally initiate alsa part
  this.alsa = config.alsa || false;
  if (this.alsa) {
    this._initAlsa();
  }

  // initiate cache settings
  this.cache = {};
  if (!config.cache) {
    config.cache = false;
  }
  this.cache.on = config.cache.on || false;
  this.cache.volume = config.cache.volume || 10;
  this.cache.volumeNeedsUpdate = false;
  this.cache.channel = config.cache.channel || 1;
  this.cache.channelNeedsUpdate = false;

  this.log("Added speaker: %s, host: %s", this.name, this.host);

}

FidelioAccessory.prototype.getServices = function() {
  return [this.informationService, this.switchService];
};

FidelioAccessory.prototype._initAlsa = function() {
  if (alsa === null) {
    this.log('Warning: Module `alsa-monitor` is not found, disabling alsa');
    this.alsa = false;
    return;
  }
  if (loudness === null) {
    this.log('Warning: Module `loudness` is not found, disabling alsa');
    this.alsa = false;
    return;
  }

  alsa.monitor(function() {
    loudness.getVolume(function (error, vol) {
      if (error) {
        this.log('Error: loudness.getVolume() failed: %s', error.message);
      } else {
        this.setVolume(vol, function(dummy){});
      }
    }.bind(this));
  }.bind(this));
};

FidelioAccessory.prototype._initWatch = function(filename) {
  // We want to watch the whole path, in case the file does not (yet) exist
  watch(path.dirname(filename), function(file) {

    // Check if we're triggerd for the correct file
    if (filename == file) {

      // Try to open file
      fs.readFile(filename, 'utf8', function(err, data) {
        if (err) {
          this.log("Error: error reading file: %s", err);
        }
        try {
          var obj = json5.parse(data);

          validVolume = (!isNaN(obj.volume) && obj.volume >= 0 && obj.volume <= 100);
          validChannel = (this.channels && !isNaN(obj.channel) && obj.channel >0 && obj.channel <= this.channels.length);



          // first update power status if applicable
          if (!isNaN(obj.on)) {

            // do not use caches if we have a new value
            if (validVolume) this.cache.volumeNeedsUpdate = false;
            if (validChannel) this.cache.channelNeedsUpdate = false;

            this.setOn(obj.on, function(dummy){
                // then update volume & channel
                if (validVolume) {
                  this.setVolume(obj.volume, function(dummy){});
                }
                if (validChannel) {
                  this.setChannel(obj.channel, function(dummy){});
                }
              }.bind(this));

          } else {
            // if no power status is included, still update volume and/or channel
            if (validVolume) {
              this.setVolume(obj.volume, function(dummy){});
            }
            if (validChannel) {
              this.setChannel(obj.channel, function(dummy){});
            }
          }

          // special case when alsa volume needs to be restored
          if (obj.volume == 'alsa' && this.alsa) {
            loudness.getVolume(function (error, vol) {
              if (error) {
                this.log('Error: loudness.getVolume() failed: %s', error.message);
              } else {
                this.setVolume(vol, function(dummy){});
              }
            }.bind(this));
          }
        } catch (error) {
          this.log("Error: file %s could not be parsed: %s", file, error.message);
        }
      }.bind(this));
    }
  }.bind(this));

};



FidelioAccessory.prototype._request = function (url, callback) {

  request(url, function (error, response, body) {
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



FidelioAccessory.prototype.getOn = function(callback, context, silent) {

  var url = this.url + 'HOMESTATUS';

  this._request(url, function (error, result) {
    if (error) {
      this.log('Error: getOn() failed: %s', error.message);
      callback(error, this.cache.on);
      return;
    }
      var obj = json5.parse(result);
      if (obj.command == 'STANDBY') {
        var powerOn = !obj.value;
        if (!silent) {
          this.log('Power is currently %d', powerOn);
        }
        callback(null, powerOn);

      } else {
        var err = "Invalid HOMESTATUS response: " + result;
        callback(new Error(err));

      }
  }.bind(this));
};

FidelioAccessory.prototype.setOn = function(on, callback) {

  if (on) {
    // switch me on by calling index
    var url = this.url + 'index';
    request(url, function (error, result) {

      if (error) {
        this.log('Error: setOn() failed: %s', error.message);
        callback(error);
      } else {
        this.log("Power set to %d", on);
        if (this.cache.volumeNeedsUpdate) {
          this.setVolume(this.cache.volume, function(dummy){});
        }
        if (this.cache.channelNeedsUpdate) {
          this.setChannel(this.cache.channel, function(dummy){});
        }
        callback(null);
      }
    }.bind(this));

  } else {
    // switch me off

    // first check if I'm not yet switched off
    this.getOn(function (err,state) {
      if (err) {
        this.log('Error: setOn() failed: %s', err.message);
        callback(err);
        return;
      }
      if (state == 1) {
        // apparently I'm switched on, so switch me off;
        var url = this.url + 'CTRL$STANDBY';
        request(url, function (error, result) {
          if (error) {
            this.log('Error: setOn() failed: %s', error.message);
            callback(error);
          } else {
            this.log("Power set to %d", on);
            callback(null);
          }
        }.bind(this));
      } else {
        callback(null);
      }
    }.bind(this), true);
  }
};

FidelioAccessory.prototype.getVolume = function(callback) {
  var url = this.url + 'ELAPSE';

  this._request(url, function (error, result) {
    if (error) {
      this.log('Error: getVolume() failed: %s', error.message);
      callback(error, this.cache.volume);
      return;
    }

    var obj = json5.parse(result);

    if (obj.command == 'ELAPSE') {
      var vol = Math.round(obj.volume / 64.0 * 100.0);
      this.log('Got current volume: %d%% (%d)', vol, obj.volume);
      this.cache.volume = vol;
      callback(null, vol);

    } else if (obj.command == 'NOTHING') {
      this.log('Returned volume from cache: %d', this.cache.volume);
      callback(null, this.cache.volume);
    } else {
      var err = "Unknown ELAPSE response: " + result;
      callback(new Error(err));
    }
  }.bind(this));

};

FidelioAccessory.prototype.setVolume = function(volume, callback) {

  this.getOn(function (error, on) {
    if (!error && on) {
      var vol = Math.round(volume / 100.0 * 64.0);

      var url = this.url + 'VOLUME$VAL$' + vol;
      request(url, function (error, result) {

        if (error) {
          this.log('Error: setVolume() failed: %s', error.message);
          callback(error);
        } else {
          this.log('Volume Set: %d%% (%d)', volume, vol);
          this.cache.volume = volume;
          this.cache.volumeNeedsUpdate = false;
          callback(null);
        }
      }.bind(this));
    } else {
      this.log('Wrote volume to cache: %d%%', volume);
      this.cache.volume = volume;
      this.cache.volumeNeedsUpdate = true;
      callback(null);
    }
  }.bind(this), 'setVolume', true);

};

FidelioAccessory.prototype.getChannel = function(callback) {
  // Currently I don't know a way to query this information from the speakers,
  // so using cache instead.

  this.log('Getting channel from cache: %d', this.cache.channel);
  callback(null, this.cache.channel);
};


FidelioAccessory.prototype.setChannel = function(channel, callback) {

  this.getOn(function (error, on) {
    if (!error && on) {

      var url = this.url + this.channels[channel-1];

      request(url, function (error, result) {
        if (error) {
          this.log('Error: setChannel() failed: %s', error.message);
          callback(error);
        } else {
          this.log("Channel set to %d (%s)", channel, this.channels[channel-1]);
          this.cache.channel = channel;
          callback(null);
        }
      }.bind(this));
    } else {
      this.log('Wrote channel to cache: %d', channel);
      this.cache.channel = channel;
      this.cache.channelNeedsUpdate = true;
      callback(null);
    }
  }.bind(this), 'setChannel', true);
};



//
// Custom Characteristic for Volume
//

function makeVolumeCharacteristic() {

  VolumeCharacteristic = function() {
    Characteristic.call(this, 'Volume', '91288267-5678-49B2-8D22-F57BE995AA93');
    this.setProps({
      format: Characteristic.Formats.INT,
      unit: Characteristic.Units.PERCENTAGE,
      maxValue: 100,
      minValue: 0,
      minStep: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
  };

  inherits(VolumeCharacteristic, Characteristic);
}

function makeChannelCharacteristic(count) {
  var id;
  if (uuid !== null) {
    id = uuid.generate('Channel-' + count);
  } else {
    this.log('Warning: hap-nodejs not found; using default uuid');
    id = '4f8c78f9-c7a2-4316-b53d-f06427f0a09a';
  }
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
