const { SerialPort } = require('serialport');
const mqtt = require('mqtt');
const { nanoid } = require('nanoid');
// const moment = require('moment');

const mavlink = require('./mavlink.js');

// let mavPortNum = 'COM18';
let mavPortNum = '/dev/ttyAMA0';
let mavBaudrate = '115200';
let mavPort = null;

let globalpositionint_msg = {};
let gpsrawint_msg = {};
let attitude_msg = {};

let mavData = {};
mavData.fix_type = 0;
mavData.lat = 0;
mavData.lon = 0;
mavData.alt = 0;
mavData.relative_alt = 0;
mavData.eph = 0;
mavData.epv = 0;
mavData.vel = 0;
mavData.cog = 0;
mavData.satellites_visible = 0;
mavData.vx = 0;
mavData.hdg = 0;

let mqttHost = '127.0.0.1';
let mqtt_client = null;
let pub_gps_location_topic = '/GPS/location';
let pub_gps_attitude_topic = '/GPS/attitude';
// let pub_gps_status_topic = '/GPS/status';


mavPortOpening();
mqtt_connect(mqttHost);
function mavPortOpening() {
    if (mavPort == null) {
        mavPort = new SerialPort({
            path: mavPortNum,
            baudRate: parseInt(mavBaudrate, 10),
        });

        mavPort.on('open', mavPortOpen);
        mavPort.on('close', mavPortClose);
        mavPort.on('error', mavPortError);
        mavPort.on('data', mavPortData);
    } else {
        if (mavPort.isOpen) {
            mavPort.close();
            mavPort = null;
            setTimeout(mavPortOpening, 2000);
        } else {
            mavPort.open();
        }
    }
}

function mavPortOpen() {
    console.log('mavPort(' + mavPort.path + '), mavPort rate: ' + mavPort.baudRate + ' open.');
}

function mavPortClose() {
    console.log('mavPort closed.');

    setTimeout(mavPortOpening, 2000);
}

function mavPortError(error) {
    console.log('[mavPort error]: ' + error.message);

    setTimeout(mavPortOpening, 2000);
}

var mavStrFromDrone = '';
var mavStrFromDroneLength = 0;
var mavVersion = 'unknown';
var mavVersionCheckFlag = false;

function mavPortData(data) {
    mavStrFromDrone += data.toString('hex').toLowerCase();
    // console.log(mavStrFromDrone)

    while (mavStrFromDrone.length > 20) {
        if (!mavVersionCheckFlag) {
            var stx = mavStrFromDrone.substr(0, 2);
            if (stx === 'fe') {
                var len = parseInt(mavStrFromDrone.substr(2, 2), 16);
                var mavLength = (6 * 2) + (len * 2) + (2 * 2);
                var sysid = parseInt(mavStrFromDrone.substr(6, 2), 16);
                var msgid = parseInt(mavStrFromDrone.substr(10, 2), 16);

                if (msgid === 0 && len === 9) { // HEARTBEAT
                    mavVersionCheckFlag = true;
                    mavVersion = 'v1';
                }

                if ((mavStrFromDrone.length) >= mavLength) {
                    var mavPacket = mavStrFromDrone.substr(0, mavLength);

                    mavStrFromDrone = mavStrFromDrone.substr(mavLength);
                    mavStrFromDroneLength = 0;
                } else {
                    break;
                }
            } else if (stx === 'fd') {
                len = parseInt(mavStrFromDrone.substr(2, 2), 16);
                mavLength = (10 * 2) + (len * 2) + (2 * 2);

                sysid = parseInt(mavStrFromDrone.substr(10, 2), 16);
                msgid = parseInt(mavStrFromDrone.substr(18, 2) + mavStrFromDrone.substr(16, 2) + mavStrFromDrone.substr(14, 2), 16);

                if (msgid === 0 && len === 9) { // HEARTBEAT
                    mavVersionCheckFlag = true;
                    mavVersion = 'v2';
                }
                if (mavStrFromDrone.length >= mavLength) {
                    mavPacket = mavStrFromDrone.substr(0, mavLength);

                    mavStrFromDrone = mavStrFromDrone.substr(mavLength);
                    mavStrFromDroneLength = 0;
                } else {
                    break;
                }
            } else {
                mavStrFromDrone = mavStrFromDrone.substr(2);
            }
        } else {
            stx = mavStrFromDrone.substr(0, 2);
            if (mavVersion === 'v1' && stx === 'fe') {
                len = parseInt(mavStrFromDrone.substr(2, 2), 16);
                mavLength = (6 * 2) + (len * 2) + (2 * 2);

                if ((mavStrFromDrone.length) >= mavLength) {
                    mavPacket = mavStrFromDrone.substr(0, mavLength);

                    setTimeout(parseMavFromDrone, 0, mavPacket);

                    mavStrFromDrone = mavStrFromDrone.substr(mavLength);
                    mavStrFromDroneLength = 0;
                } else {
                    break;
                }
            } else if (mavVersion === 'v2' && stx === 'fd') {
                len = parseInt(mavStrFromDrone.substr(2, 2), 16);
                mavLength = (10 * 2) + (len * 2) + (2 * 2);

                if (mavStrFromDrone.length >= mavLength) {
                    mavPacket = mavStrFromDrone.substr(0, mavLength);

                    setTimeout(parseMavFromDrone, 0, mavPacket);

                    mavStrFromDrone = mavStrFromDrone.substr(mavLength);
                    mavStrFromDroneLength = 0;
                } else {
                    break;
                }
            } else {
                mavStrFromDrone = mavStrFromDrone.substr(2);
            }
        }
    }
}

function mqtt_connect(broker_ip) {
    if (mqtt_client == null) {
        let connectOptions = {
            host: broker_ip,
            port: 1883,
            protocol: "mqtt",
            keepalive: 10,
            clientId: 'GPS_' + nanoid(15),
            protocolId: "MQTT",
            protocolVersion: 4,
            clean: true,
            reconnectPeriod: 2000,
            connectTimeout: 2000,
            rejectUnauthorized: false
        }

        mqtt_client = mqtt.connect(connectOptions);

        mqtt_client.on('connect', function () {
            console.log('mqtt connected to ' + broker_ip);
        });

        mqtt_client.on('error', function (err) {
            console.log('[mqtt_client error] ' + err.message);
            setTimeout(mqtt_connect, 1000, broker_ip);
        });
    }
}


function parseMavFromDrone(mavPacket) {
    try {
        var ver = mavPacket.substr(0, 2);
        var msglen = mavPacket.substr(2, 2);
        // var sysid = '';
        var msgid = '';
        var base_offset = 12;

        if (ver == 'fd') {
            // sysid = mavPacket.substr(10, 2).toLowerCase();
            msgid = mavPacket.substr(18, 2) + mavPacket.substr(16, 2) + mavPacket.substr(14, 2);
            base_offset = 20;
        } else {
            sysid = mavPacket.substr(6, 2).toLowerCase();
            msgid = mavPacket.substr(10, 2).toLowerCase();
            base_offset = 12;
        }

        // var sys_id = parseInt(sysid, 16);
        var msg_id = parseInt(msgid, 16);
        var msg_len = parseInt(msglen, 16);

        // var cur_seq = parseInt(mavPacket.substr(4, 2), 16);

        if (msg_id == mavlink.MAVLINK_MSG_ID_GLOBAL_POSITION_INT) { // #33
            var time_boot_ms = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var lat = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var lon = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var alt = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var relative_alt = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 20;
            var hdg = mavPacket.substr(base_offset, 4).toLowerCase();


            globalpositionint_msg.time_boot_ms = Buffer.from(time_boot_ms, 'hex').readUInt32LE(0);
            globalpositionint_msg.lat = Buffer.from(lat, 'hex').readInt32LE(0) / 10000000;
            globalpositionint_msg.lon = Buffer.from(lon, 'hex').readInt32LE(0) / 10000000;
            globalpositionint_msg.alt = Buffer.from(alt, 'hex').readInt32LE(0) / 1000;
            globalpositionint_msg.relative_alt = Buffer.from(relative_alt, 'hex').readInt32LE(0) / 1000;
            globalpositionint_msg.hdg = Buffer.from(hdg, 'hex').readUInt16LE(0) / 100;

            // console.log('globalpositionint_msg heading = ' + globalpositionint_msg.hdg);
            mqtt_client.publish(pub_gps_location_topic, JSON.stringify(globalpositionint_msg));

        } else if (msg_id === mavlink.MAVLINK_MSG_ID_ATTITUDE) {
            let my_len = 28;
            let ar = mavPacket.split('');
            for (let i = 0; i < (my_len - msg_len); i++) {
                ar.splice(ar.length - 4, 0, '0');
                ar.splice(ar.length - 4, 0, '0');
            }
            mavPacket = ar.join('');
            time_boot_ms = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var roll = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var pitch = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var yaw = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var rollspeed = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var pitchspeed = mavPacket.substr(base_offset, 8).toLowerCase();
            base_offset += 8;
            var yawspeed = mavPacket.substr(base_offset, 8).toLowerCase();

            attitude_msg.time_boot_ms = Buffer.from(time_boot_ms, 'hex').readUInt32LE(0);
            attitude_msg.roll = Buffer.from(roll, 'hex').readFloatLE(0) * 180 / Math.PI;
            attitude_msg.pitch = Buffer.from(pitch, 'hex').readFloatLE(0) * 180 / Math.PI;
            attitude_msg.yaw = Buffer.from(yaw, 'hex').readFloatLE(0) * 180 / Math.PI;
            attitude_msg.rollspeed = Buffer.from(rollspeed, 'hex').readFloatLE(0);
            attitude_msg.pitchspeed = Buffer.from(pitchspeed, 'hex').readFloatLE(0);
            attitude_msg.yawspeed = Buffer.from(yawspeed, 'hex').readFloatLE(0);

            // let arrRoll = [];
            // let arrPitch = [];
            // let info = {};
            // let heading = 0;

            // arrRoll.push((-1) * roll * 100);
            // while (arrRoll.length > 3) {
            //     arrRoll.shift();
            // }

            // attitude_msg.roll = arrRoll.reduce((p, c) => p + c, 0) / arrRoll.length;
            // attitude_msg.roll = attitude_msg.roll * (180 / 3.14);

            // info.bankAngle = (-1) * attitude_msg.roll;
            // // console.log('roll(rad): ' + (roll));

            // arrPitch.push(pitch * 100);
            // while (arrPitch.length > 3) {
            //     arrPitch.shift();
            // }
            // attitude_msg.pitch = arrPitch.reduce((p, c) => p + c, 0) / arrPitch.length;
            // attitude_msg.pitch = attitude_msg.pitch * (180 / 3.14);

            // info.anglePitch = attitude_msg.pitch;
            // // console.log('pitch(rad): ' + (pitch));
            // // console.log('pitch(deg): ' + (pitch * (180/3.14)));
            // // console.log('roll: ' + roll, 'pitch: ' + pitch);

            // if (attitude_msg.yaw < 0) {
            //     attitude_msg.yaw += (2 * Math.PI);
            // }
            // // console.log('yaw', ((yaw * 180) / Math.PI));
            // heading = ((attitude_msg.yaw * 180) / Math.PI);

            // // console.log('attitude heading = ' + heading);

            mqtt_client.publish(pub_gps_attitude_topic, JSON.stringify(attitude_msg), () => {
                // console.log('publish message to local mqtt: ', attitude_msg)
            });
        }
        else if (msg_id === mavlink.MAVLINK_MSG_ID_GPS_RAW_INT) {
            let my_len = 30;
            if (ver === 'fd') {
                my_len += 22;
            }
            let ar = mavPacket.split('');
            for (let i = 0; i < (my_len - msg_len); i++) {
                ar.splice(ar.length - 4, 0, '0');
                ar.splice(ar.length - 4, 0, '0');
            }
            mavPacket = ar.join('');

            var fix_type = mavPacket.substring(18, 20);

            base_offset += (16 + 2 + 8 + 8 + 8 + 4 + 4 + 4 + 4);
            var satellites = mavPacket.substr(base_offset, 2).toLowerCase();

            gpsrawint_msg.num_satellites = Buffer.from(satellites, 'hex').readUInt8(0);
            gpsrawint_msg.fix_type = Buffer.from(fix_type, 'hex').readUInt8(0);

            // console.log('fix_type: ' + fix_type + '\n');
            //console.log("MAVLINK_MSG_ID_GPS_RAW_INT", "num_satellites ", this.num_satellites);

            // mqtt_client.publish(pub_gps_status_topic, JSON.stringify(gpsrawint_msg));
        }
    } catch (e) {
        console.log('[parseMavFromDrone Error]', e);
    }
}