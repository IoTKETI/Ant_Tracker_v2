const mqtt = require('mqtt');
const { nanoid } = require("nanoid");
const fs = require('fs');

let drone_info = {};
try {
    drone_info = JSON.parse(fs.readFileSync('drone_info.json', 'utf8'));
} catch (e) {
    console.log('can not find [ drone_info.json ] file');
    drone_info.host = "121.137.228.240";
    drone_info.drone = "UMACA1";
    drone_info.gcs = "UMACAIR";
    drone_info.type = "ardupilot";
    drone_info.system_id = 1;
    drone_info.gcs_ip = "192.168.1.150";

    fs.writeFileSync('./drone_info.json', JSON.stringify(drone_info, null, 4), 'utf8');
}

let local_mqtt_host = '127.0.0.1';
let localmqtt = null;

let gcs_mqtt_host = drone_info.gcs_ip;
let gcs_mqtt = null;
// let gcs_mqtt_message = '';

let sub_drone_data_topic = '/RF/TELE_HUB/drone';
// let sub_drone_data_topic = '/gcs/TELE_HUB/drone/rf/' + drone_info.drone;
//let sub_drone_data_topic = '/Mobius/UMACAIR/Drone_Data/' + drone_info.drone;
let sub_pan_motor_position_topic = '/Ant_Tracker/Motor_Pan';
let sub_tilt_motor_position_topic = '/Ant_Tracker/Motor_Tilt';

let pub_drone_data_topic = '/RF/TELE_HUB/drone';
let motor_control_topic = '/Ant_Tracker/Control';
let motor_altitude_topic = '/Ant_Tracker/Altitude';

//------------- local mqtt connect ------------------
function local_mqtt_connect(host) {
    let connectOptions = {
        host: host,
        port: 1883,
        protocol: "mqtt",
        keepalive: 10,
        clientId: 'local_' + nanoid(15),
        protocolId: "MQTT",
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 2000,
        connectTimeout: 2000,
        rejectUnauthorized: false
    }

    localmqtt = mqtt.connect(connectOptions);

    localmqtt.on('connect', function () {
        localmqtt.subscribe(sub_pan_motor_position_topic + '/#', () => {
            // console.log('[pan] pan status subscribed -> ', sub_pan_motor_position_topic);
        });
        localmqtt.subscribe(sub_tilt_motor_position_topic + '/#', () => {
            // console.log('[tilt] tilt status subscribed -> ', sub_tilt_motor_position_topic);
        });
    });

    localmqtt.on('message', function (topic, message) {
        // console.log('[motor] topic, message => ', topic, message.toString());
        if (topic === sub_pan_motor_position_topic) {
            try {
                gcs_mqtt.publish(sub_pan_motor_position_topic, message.toString(), () => {
                    // console.log('send target drone data: ', pub_drone_data_topic, message);
                });
            } catch {
            }
        } else if (topic === sub_tilt_motor_position_topic) {
            try {
                gcs_mqtt.publish(sub_tilt_motor_position_topic, message.toString(), () => {
                    // console.log('send target drone data: ', pub_drone_data_topic, message);
                });
            } catch {
            }
        }

    });

    localmqtt.on('error', function (err) {
        console.log('[tilt] local mqtt connect error ' + err.message);
        localmqtt = null;
        setTimeout(local_mqtt_connect, 1000, local_mqtt_host);
    });
}
//---------------------------------------------------

//------------- gcs mqtt connect ------------------
function gcs_mqtt_connect(host) {
    let connectOptions = {
        host: host,
        port: 1883,
        protocol: "mqtt",
        keepalive: 10,
        clientId: 'sitl_' + nanoid(15),
        protocolId: "MQTT",
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 2000,
        connectTimeout: 2000,
        rejectUnauthorized: false
    }

    gcs_mqtt = mqtt.connect(connectOptions);

    gcs_mqtt.on('connect', function () {
        gcs_mqtt.subscribe(sub_drone_data_topic + '/#', () => {
            console.log('[gcs] gcs_mqtt subscribed -> ', sub_drone_data_topic);
        });
        gcs_mqtt.subscribe(motor_control_topic + '/#', () => {
            console.log('[gcs] gcs_mqtt subscribed -> ', motor_control_topic);
        });
        gcs_mqtt.subscribe(motor_altitude_topic + '/#', () => {
            console.log('[gcs] gcs_mqtt subscribed -> ', motor_altitude_topic);
        });
    });

    gcs_mqtt.on('message', function (topic, message) {
        //console.log('[gcs] topic, message => ', topic, message.toString('hex'));

        if (topic.includes(sub_drone_data_topic)) {
            gcs_mqtt_message = message.toString('hex');
            try {
                localmqtt.publish(pub_drone_data_topic, Buffer.from(message, 'hex'), () => {
                    // console.log('send target drone data: ', pub_drone_data_topic, message);
                });
            } catch {
            }
        } else if (topic === motor_control_topic) {
            try {
                localmqtt.publish(motor_control_topic, message.toString(), () => {
                    // console.log('send motor control message: ', motor_control_topic, message.toString());
                });
            } catch {
            }
        } else if (topic === motor_altitude_topic) {
            try {
                localmqtt.publish(motor_altitude_topic, message.toString(), () => {
                    // console.log('send motor control message: ', motor_control_topic, message.toString());
                });
            } catch {
            }
        }
    });

    gcs_mqtt.on('error', function (err) {
        console.log('[tilt] sitl mqtt connect error ' + err.message);
        gcs_mqtt = null;
        setTimeout(gcs_mqtt_connect, 1000, gcs_mqtt_host);
    });
}
//---------------------------------------------------

local_mqtt_connect('127.0.0.1')
gcs_mqtt_connect(gcs_mqtt_host);




