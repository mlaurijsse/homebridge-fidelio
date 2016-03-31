# Fidelio Platform
This is a plugin for [Homebridge](https://github.com/nfarina/homebridge). This plugin enables control of the Philips Fidelio A1, A3, A5 and A9 (also known as AW1000, AW3000, AW5000, AW9000) via iOS HomeKit.

## Install
To install globally:
```
sudo npm install -g https://github.com/mlaurijsse/homebridge-fidelio
```

## Config
Example config.json:

```
{
  "accessories": [
    {
      "accessory": "Fidelio",
      "name": "Living Room Speakers",
      "host": "192.168.0.10",
      "channels": [
        "nav$03$03$001$1",
        "nav$03$03$002$1",
        "nav$03$03$003$1",
        "nav$03$03$004$1",
        "nav$03$03$005$1",
        "digin_optical"
      ],
      "file": "/path/to/file",
      "alsa": true
    }
  ]
}

```
The `host` can be a hostname or ip address. The hostname of your speaker can be configured using the Airstudio+ app. However, I found reference by hostname was unstable in my setup, during boot/reset the hostname 'blackfin' is sometimes used.

The `channels` represent different sources supported by the speaker. To investigate all options please visit http://hostname:8889/index

If the option `file` is set, this file can be used to give "commands" in json5 format, e.g.,

```
{
  on: true,
  channel: 1,
  volume: 20
}
```
None of the fields are mandatory.

If the option `alsa` is set to true, the volume of this speaker will follow the volume of alsa mixer (default device).

Note that the name "Speakers" is used in the name for this example instead of something more intuitive like "Philips" or "Music" or "Radio", as Siri has many stronger associations for those words. For instance, including "Music" in the name will cause Siri to launch the built-in Music app.
