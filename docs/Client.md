# Client
	cordova-build -mode:client

## General Options
	-build:<platforms>
		platforms on which the application should be build
		values: [android,ios,wp8]
	-files:<file.7z,file.zip>
		comma-separated list of file(s) (zip- or 7z-archives) for all platforms

## General Options (optional)
	-server:<domain/IP>
		the server's domain or IP
		default: localhost
	-port:<port>
		the server's port (int)
		default:8300
    -save:<path>
		path where the agents' results (e.g. android's apks) should be stored
		default:none

## iOS-Options
	-ios:<file.7z,file.zip>
		platform specific file(s): zip- or 7z-archives (only for ios builds)
	-iosprovisioningpath:"platforms/ios/build/device/your-project-name.app"

	-iosprovisioningpath:"path-to-your-provision-file.mobileprovision"

	-ioscodesignidentity:"your-provision-name"

	-iosmanifesturl:"https://domain.co.uk/download.aspx?name=Info.plist&url={0}"

## WP8-Options (optional)
	-wp8:<file.7z,file.zip>
		platform specific file(s): zip- or 7z-archives (only for wp8 builds)

## Android-Options (optional)
	-android:<file.7z,file.zip>
		platform specific file(s): zip- or 7z-archives (only for android builds)

	-androidsign:<file.sign>
		//@TODO: examine

## Examples
	cordova-build -mode:client