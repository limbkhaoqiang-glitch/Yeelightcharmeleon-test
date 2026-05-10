import udp from "@SignalRGB/udp";

export function Name() { return "Yeelight"; }
export function Version() { return "1.0.1"; }
export function Type() { return "network"; }
export function Publisher() { return "WhirlwindFX"; }
export function Size() { return [48, 48]; }
export function DefaultPosition() {return [75, 70]; }
export function DefaultScale(){return 1.0;}

/* global
discovery:readonly
controller:readonly
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
*/

export function ControllableParameters() {
	return [
		{"property":"shutdownColor", "group":"lighting", "label":"Shutdown Color", "type":"color", "default":"#009bde"},
		{"property":"LightingMode", "group":"lighting", "label":"Lighting Mode", "type":"combobox", "values":["Canvas", "Forced"], "default":"Canvas"},
		{"property":"forcedColor", "group":"lighting", "label":"Forced Color", "type":"color", "default":"#009bde"},
	];
}

// --- Global Variables ---
let udpServer;
let lastPollTime = Date.now();
let lastData = 0;
let lightOff = false;
let DeviceMaxLedLimit = 1;
let vLedNames = [ "Main Zone" ];
let vLedPositions = [ [0, 0] ];

export function ledNames() { return vLedNames; }
export function ledPositions() { return vLedPositions; }

// --- Primary Logic ---

export function Initialize() {
	Yeelight.fetchUDPToken();
	fetchDeviceConfig();
	device.setName(YeelightDeviceLibrary.getDeviceNameFromModel(controller.model));
	Yeelight.setSupportsBackgroundRGB(controller.supportsBackgroundRGB);
	Yeelight.setSupportsPerLED(controller.supportsPerLED);
}

export function Render() {
	if(Yeelight.getIsTokenActive()) {
		if(!Yeelight.getIsInitialized()) {
			deviceInitialization();
			return;
		}

		sendColors();
		checkTimeSinceLastPacket();
	}
}

export function Shutdown(SystemSuspending) {
	if(SystemSuspending){
		sendColors("#000000");
	} else {
		sendColors(shutdownColor);
	}
}

function deviceInitialization() {
	Yeelight.setDevicePower(true);
	Yeelight.setDeviceBrightness(100);
	Yeelight.setIsInitialized(true);
}

function sendColors(overrideColor) {
	const RGBData = grabColors(overrideColor);

	if(lastData !== RGBData) {
		if(RGBData === 0) {
			Yeelight.setDevicePower(false); 
			lightOff = true;
		} else {
			if (lightOff) {
				Yeelight.setDevicePower(true);
				lightOff = false;
			}
			Yeelight.getSupportsBackgroundRGB() ? Yeelight.setBGRGB(RGBData) : Yeelight.setRGB(RGBData);
		}
		lastData = RGBData;
	}
}

function grabColors(overrideColor) {
	let r, g, b;

	if (overrideColor || LightingMode === "Forced") {
		const targetHex = overrideColor || forcedColor;
		const rgbArray = hexToRgb(targetHex);
		r = rgbArray[0];
		g = rgbArray[1];
		b = rgbArray[2];
	} else {
		const col = device.color(0, 0);
		r = col[0];
		g = col[1];
		b = col[2];
	}

	// Clamp to 0-255 for protocol safety
	r = Math.min(255, Math.max(0, Math.round(r)));
	g = Math.min(255, Math.max(0, Math.round(g)));
	b = Math.min(255, Math.max(0, Math.round(b)));

	return (r << 16) | (g << 8) | b;
}

function hexToRgb(hex) {
	const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
}

function fetchDeviceConfig() {
	const deviceConfig = YeelightDeviceLibrary.getModelLayout(controller.model);
	vLedNames = deviceConfig.vLedNames;
	vLedPositions = deviceConfig.vLedPositions;
	DeviceMaxLedLimit = deviceConfig.DeviceMaxLedLimit;

	Yeelight.setUsesComponents(deviceConfig.usesComponents);
	Yeelight.setSupportsStandardRGB(deviceConfig.supportsStandardRGB);
	Yeelight.setSupportsBackgroundRGB(deviceConfig.supportsBackgroundRGB);
	Yeelight.setSupportsPerLED(deviceConfig.supportsPerLED);
	Yeelight.setSupportsSegments(deviceConfig.supportsSegments);
	
	device.setControllableLeds(deviceConfig.vLedNames, deviceConfig.vLedPositions);
	device.setSize(deviceConfig.size);
}

function checkTimeSinceLastPacket() {
	if(Date.now() - lastPollTime > 9000) {
		Yeelight.UDPKeepalive();
		lastPollTime = Date.now();
	}
}

// --- Classes and Protocol ---

class YeelightProtocol {
	constructor() {
		this.config = { supportsStandardRGB : false, supportsBackgroundRGB : false, supportsPerLED: false, supportsSegments: false, usesComponents: false };
		this.token = "";
		this.packetIDX = 1;
		this.isInDirectMode = false;
		this.isInitialized = false;
	}

	getPacketIDX() { return this.packetIDX; }
	incrementPacketIDX() { this.packetIDX ++; }
	getIsTokenActive() { return this.token.length > 0; }
	getToken() { return this.token; }
	setToken(token) { this.token = token; }
	getIsInitialized() { return this.isInitialized; }
	setIsInitialized(isInitialized) { this.isInitialized = isInitialized; }
	setSupportsBackgroundRGB(val) { this.config.supportsBackgroundRGB = val; }
	getSupportsBackgroundRGB() { return this.config.supportsBackgroundRGB; }
    setUsesComponents(v) { this.config.usesComponents = v; }
    setSupportsStandardRGB(v) { this.config.supportsStandardRGB = v; }
    setSupportsPerLED(v) { this.config.supportsPerLED = v; }
    setSupportsSegments(v) { this.config.supportsSegments = v; }

	fetchUDPToken() {
		this.packetIDX = 1;
		this.sendPacket(`{"id":${this.getPacketIDX()},"method":"udp_sess_new","params":[]}\r\n`);
	}

	parseUDPToken(authToken) {
		this.setToken(JSON.parse(authToken.data).params.token);
		device.pause(100);
		this.UDPKeepalive();
	}

	UDPKeepalive() {
		this.sendPacket(`{"id":${this.getPacketIDX()},"method":"udp_sess_keep_alive","params":["keeplive_interval",10],"token":"${this.getToken()}"}\r\n`);
	}

	setDevicePower(on) {
		this.sendPacket(`{"id":${this.getPacketIDX()},"method":"${this.getSupportsBackgroundRGB() ? "bg_set_power" : "set_power"}","params":["${on ? "on" : "off"}","sudden"],"token":"${this.getToken()}"}\r\n`);
	}

	setDeviceBrightness(brightness) {
		this.sendPacket(`{"id":${this.getPacketIDX()},"method":"${this.getSupportsBackgroundRGB() ? "bg_set_bright" : "set_bright"}","params":[${brightness},"sudden",0],"token":"${this.getToken()}"}\r\n`);
	}

	setBGRGB(colors) {
		this.sendPacket(`{"id":${this.getPacketIDX()},"method":"bg_set_rgb","params":[${colors},"sudden",0],"token":"${this.getToken()}"}\r\n`);
	}

	setRGB(colors) {
		this.sendPacket(`{"id":${this.getPacketIDX()},"method":"set_rgb","params":[${colors},"sudden",0],"token":"${this.getToken()}"}\r\n`);
	}

	sendPacket(packet) {
		if(udpServer === undefined) {
			udpServer = new UdpSocketServer(controller.ip, 55444);
			udpServer.start();
		}
		udpServer.sendPacket(packet);
		this.incrementPacketIDX();
		lastPollTime = Date.now();
	}
}

const Yeelight = new YeelightProtocol();

class deviceLibrary {
	constructor() {
		this.modelDict = { " lamp15" : "Monitor Lightbar Pro", " strip8" : "LED Light Strip Pro" };
		this.modelLibrary = {
			"Monitor Lightbar Pro" : { usesComponents: false, supportsStandardRGB : false, supportsBackgroundRGB : true, supportsPerLED: false, supportsSegments: false, vLedPositions : [ [0, 0] ], vLedNames : [ "Main Zone" ], size : [ 3, 1 ], DeviceMaxLedLimit: 1 },
			"LED Light Strip Pro" : { usesComponents: false, supportsStandardRGB : true, supportsBackgroundRGB : false, supportsPerLED: false, supportsSegments: false, vLedPositions : [ [0, 0] ], vLedNames : [ "Main Zone" ], size : [ 1, 1 ], DeviceMaxLedLimit: 1 }
		};
	}
	getDeviceNameFromModel(model) { return this.modelDict[model] || model; }
	getModelLayout(model) { return this.modelLibrary[this.modelDict[model]] || { vLedNames : [ "Main Zone" ], vLedPositions : [ [ 0, 0 ] ], size: [ 1, 1 ], DeviceMaxLedLimit: 1 }; }
}

const YeelightDeviceLibrary = new deviceLibrary();

class UdpSocketServer {
	constructor (ip, port) {
		this.server = null;
		this.listenPort = 0;
		this.broadcastPort = port;
		this.ipToConnectTo = ip;
		this.IDToCheckFor = 0;
	}
	setIDToCheckFor(ID) { this.IDToCheckFor = ID; }
	sendPacket(packet) { if(this.server) this.server.send(packet); }
	start() {
		this.server = udp.createSocket();
		if(this.server) {
			this.server.on('message', (msg) => {
				if(this.IDToCheckFor === 0) { Yeelight.parseUDPToken(msg); return; }
			});
			this.server.bind(this.listenPort);
			this.server.connect(this.ipToConnectTo, this.broadcastPort);
		}
	}
}
