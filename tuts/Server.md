```sh
cordova-build -mode:server
```
---
## Options (optional)
    -location:<path>
        relative or absolute path to the builds directory
        default: ./builds
    -port:<port>
        the server's port (int)
        default:8300
    -keep:<int>
        number of temporary directories that should not be deleted
        default:0
    -ui:<boolean>
        enables (true) or disables (false) the UI on the server
        true: UI is acessible via <domain/IP>:<port> (default: localhost:8300)
        false: use UI-mode to create a UI on a custom server and port
        default:true

## Examples
```sh
cordova-build -mode:server 

cordova-build -mode:server -location:build_dir -port:1337
```