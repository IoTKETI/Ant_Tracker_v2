const mqtt = require('mqtt');
const { nanoid } = require("nanoid");
const fs = require("fs");
const { exec } = require("child_process");

let gcs_mqtt_host = 'gcs.iotocean.org';
let gcsmqtt = null;

let sub_drone_info_topic = '/Ant_Tracker/drone_info';
let drone_info_message = '';

function gcsMqttConnect(host) {
    let connectOptions = {
        host: host,
        port: 1883,
        protocol: "mqtt",
        keepalive: 10,
        clientId: 'gcs_' + nanoid(15),
        protocolId: "MQTT",
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 2000,
        connectTimeout: 2000,
        rejectUnauthorized: false
    }

    gcsmqtt = mqtt.connect(connectOptions);

    gcsmqtt.on('connect', function () {
        gcsmqtt.subscribe(sub_drone_info_topic + '/#', () => {
            console.log('[pan] gcs mqtt subscribed -> ', sub_drone_info_topic);
        });
    });

    gcsmqtt.on('message', function (topic, message) {
        // console.log('[gcs] topic, message => ', topic, message);
        if (topic.includes(sub_drone_info_topic)) {
            drone_info_message = message.toString();

            fs.writeFile('./drone_info.json', JSON.stringify(drone_info_message, null, 4), 'utf-8', function (error) {
                // console.log(error);
            });

            exec('pm2 restart setIP.js', (error, stdout, stderr) => {
                if (error) {
                    console.error(`error : ${error}`);
                    return;
                }
                if (stdout) {
                    console.log(`stdout: ${stdout}`);
                }
                if (stderr) {
                    console.error(`stderr: ${stderr}`);
                }
                exec('sudo reboot', (error, stdout, stderr) => {
                    if (error) {
                        console.error(`error : ${error}`);
                        return;
                    }
                    if (stdout) {
                        console.log(`stdout: ${stdout}`);
                    }
                    if (stderr) {
                        console.error(`stderr: ${stderr}`);
                    }
                });
            });
        }
    });

    gcsmqtt.on('error', function (err) {
        console.log('[pan] GCS mqtt connect error ' + err.message);
        gcsmqtt = null;
        setTimeout(gcsMqttConnect, 1000, gcs_mqtt_host);
    });
}

gcsMqttConnect(gcs_mqtt_host)