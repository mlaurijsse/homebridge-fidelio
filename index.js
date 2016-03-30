var inherits = require('util').inherits;
var request = require('request');
var json5 = require('json5');
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
  if (config.channels) {
    this.channels = config.channels;

    // Make channel-n Characteristic
    channelCharacteristic = makeChannelCharacteristic(this.channels.length);

    // Add Characteristic to switchService
    this.switchService
      .addCharacteristic(channelCharacteristic)
      .on('get', this.getChannel.bind(this))
      .on('set', this.setChannel.bind(this));
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



FidelioAccessory.prototype.getOn = function(callback, silent) {

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

        callback(new Error("Invalid HOMESTATUS response"));

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
          this.setVolume(this.cache.volume, callback);
        } else {
          callback(null);
        }
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
      callback(new Error("Unknown ELAPSE response"));
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
  }.bind(this), true);

};

FidelioAccessory.prototype.getChannel = function(callback) {
  // Currently I don't know a way to query this information from the speakers,
  // so using cache instead.

  this.log('Getting channel from cache: %d', this.cache.channel);
  callback(null, this.cache.channel);
};


FidelioAccessory.prototype.setChannel = function(channel, callback) {

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
