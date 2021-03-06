```sh
cordova-build -mode:agent
```
---
## Options
	-agent:<platforms>
		platforms for which this agent performs builds (required)
		values: [android,ios,wp8]

## Options (optional)
	-agentwork:<path>
		relative or absolute path to the agent's temporary directory
		default: work
	-agentname:<name>
		the agent's name; visible in the UI
		default: random string
	-reuseworkfolder:<boolean>
		true: overwrites <agentwork> on each build
		false: creates subdirectory for each build
		default: false
	-keep:<int>
		number of temporary directories that should not be deleted
		ignored if reuseworkfolder is true
		default:0

	-server:<domain/IP>
		the server's domain or IP
		default: localhost
	-port:<port>
		the server's port
		default: 8300

## Example
```sh
cordova-build -mode:agent -agent:android \
			  -agentwork:tmp/ -agentname:Larry \
			  -reuseworkfolder:true
```