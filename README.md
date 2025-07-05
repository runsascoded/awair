```console
$ cat raw.json | jq -c '.data[] | ({timestamp} + (.sensors | map({"key": .comp, value}) | from_entries)) | {timestamp,temp,co2,pm10,pm25,humid,voc}'
{"timestamp":"2025-07-05T22:22:06.331Z","temp":73.36,"co2":563,"pm10":3,"pm25":2,"humid":52.31,"voc":96}
{"timestamp":"2025-07-05T22:21:06.063Z","temp":73.33,"co2":562,"pm10":3,"pm25":2,"humid":52.23,"voc":92}
{"timestamp":"2025-07-05T22:20:05.807Z","temp":73.45,"co2":563,"pm10":2,"pm25":1,"humid":52.18,"voc":94}
{"timestamp":"2025-07-05T22:19:05.552Z","temp":73.31,"co2":564,"pm10":3,"pm25":2,"humid":52.23,"voc":90}
{"timestamp":"2025-07-05T22:18:05.291Z","temp":73.36,"co2":562,"pm10":3,"pm25":2,"humid":52.14,"voc":92}
```
