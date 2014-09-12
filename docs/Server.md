# Server
	cordova-build -mode:server

## Options
	-location:<path>
		relative or absolute path to the builds directory
		default: ./builds
	-port:<port>
		the server's port (int)
		default:8300
	-keep:<int>
		number of temporary directories that should not be deleted
		default:0


## Examples
	cordova-build -mode:server 

	cordova-build -mode:server -location:build_dir -port:1337