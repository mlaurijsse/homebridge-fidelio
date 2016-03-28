
# Fidelio Platform

Example config.json:

```
  {
    "accessories": [
      {
        "accessory": "Fidelio",
        "name": "Living Room Speakers",
        "host": "Living_Room"
        "channels": [
          "nav$03$03$001$1",
          "nav$03$03$002$1",
          "nav$03$03$003$1",
          "nav$03$03$004$1",
          "nav$03$03$005$1",
          "digin_optical"
        ]
      }
    ]
  }
```

The `host` can be a hostname or ip address. The hostname of your speaker can be configured using the Airstudio+ app. However, I found reference by hostname was unstable in my setup, during boot/reset the hostname 'blackfin' is sometimes used.

The `channels` represent different sources supported by the speaker. To investigate all options please visit http://hostname:8889/index

Note that the name "Speakers" is used in the name for this example instead of something more intuitive like "Philips" or "Music" or "Radio", as Siri has many stronger associations for those words. For instance, including "Music" in the name will cause Siri to launch the built-in Music app.
