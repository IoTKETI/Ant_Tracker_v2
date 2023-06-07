/**
 * Created by Wonseok Jung in KETI on 2023-04-26.
 */

const { exec } = require("child_process");
const os = require("os");
const mqtt = require('mqtt');
const { nanoid } = require('nanoid');

//let conf = require('./conf');
const fs = require("fs");

const rfPort = 'eth0'; // Set to eth1 if using Crow-Cube, and set to eth0 if using Crow-D.

let local_mqtt_client = null;
let local_pub_ready_topic = '/ip/ready';

let drone_info = {};
try {
    drone_info = JSON.parse(fs.readFileSync('./drone_info.json', 'utf8'));
} catch (e) {
    console.log('can not find [ ./drone_info.json ] file');

    drone_info.host = "121.137.228.240";
    drone_info.drone = "UMACA1";
    drone_info.gcs = "UMACAIR";
    drone_info.type = "ardupilot";
    drone_info.system_id = 1;
    drone_info.gcs_ip = "192.168.1.150";

    fs.writeFileSync('./drone_info.json', JSON.stringify(drone_info, null, 4), 'utf8');
}

let IPready = { "status": "not ready" };
fs.writeFileSync('./readyIP.json', JSON.stringify(IPready, null, 4), 'utf8');

setIPandRoute(drone_info.gcs_ip);

local_mqtt_connect('localhost');  // connect to GCS

function local_mqtt_connect(serverip) {
    if (local_mqtt_client === null) {
        let connectOptions = {
            host: serverip,
            port: 1883,
            protocol: "mqtt",
            keepalive: 60,
            clientId: 'rf_RC_RF_' + nanoid(15),
            protocolId: "MQTT",
            protocolVersion: 4,
            clean: true,
            reconnectPeriod: 2000,
            connectTimeout: 30000,
            rejectUnauthorized: false
        }

        local_mqtt_client = mqtt.connect(connectOptions);

        local_mqtt_client.on('connect', function () {
            console.log('local_mqtt_client is connected to Drone( ' + serverip + ' )');
        });

        local_mqtt_client.on('message', function (topic, message) {
            console.log('[local_mqtt_client] Received ' + message.toString() + ' From ' + topic);
        });

        local_mqtt_client.on('error', function (err) {
            console.log('[local_mqtt_client] error - ' + err.message);
            local_mqtt_client = null;
            local_mqtt_connect(serverip);
        });
    }
}

function setIPandRoute(host) {
    let host_arr = host.split('.');
    host_arr[3] = '120';
    let drone_ip = host_arr.join('.');

    var networkInterfaces = os.networkInterfaces();
    if (networkInterfaces.hasOwnProperty(rfPort)) {
        if (networkInterfaces[rfPort][0].family === 'IPv4') {
            if (networkInterfaces[rfPort][0].address !== drone_ip) {
                // set static ip
                exec('sudo ifconfig ' + rfPort + ' ' + drone_ip, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[error] in static ip setting : ${error}`);
                        return;
                    }
                    if (stdout) {
                        console.log(`stdout: ${stdout}`);
                    }
                    if (stderr) {
                        console.error(`stderr: ${stderr}`);
                    }
                    console.log(os.networkInterfaces());
                    // set route
                    exec('sudo route add -net ' + host_arr[0] + '.' + host_arr[1] + '.' + host_arr[2] + '.0 netmask 255.255.255.0 gw ' + drone_ip, (error, stdout, stderr) => {
                        if (error) {
                            console.error(`[error] in routing table setting : ${error}`);
                            return;
                        }
                        if (stdout) {
                            console.log(`stdout: ${stdout}`);
                        }
                        if (stderr) {
                            console.error(`stderr: ${stderr}`);
                        }
                        exec('route', (error, stdout, stderr) => {
                            if (error) {
                                console.error(`[error] in routing table setting : ${error}`);
                                return;
                            }
                            if (stdout) {
                                console.log(`stdout: ${stdout}`);
                                if (local_mqtt_client !== null) {
                                    local_mqtt_client.publish(local_pub_ready_topic, 'ready', () => {
                                        console.log('send ready message to localhost(' + local_pub_ready_topic + ')-', 'ready');
                                    });
                                    IPready.status = 'ready';
                                    fs.writeFileSync('../readyIP.json', JSON.stringify(IPready, null, 4), 'utf8');
                                }
                            }
                            if (stderr) {
                                console.error(`stderr: ${stderr}`);
                            }
                        });
                    });
                });
            } else {
                // set route
                exec('sudo route add -net ' + host_arr[0] + '.' + host_arr[1] + '.' + host_arr[2] + '.0 netmask 255.255.255.0 gw ' + drone_ip, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`[error] in routing table setting : ${error}`);
                        return;
                    }
                    if (stdout) {
                        console.log(`stdout: ${stdout}`);
                    }
                    if (stderr) {
                        console.error(`stderr: ${stderr}`);
                    }
                    exec('route', (error, stdout, stderr) => {
                        if (error) {
                            console.error(`[error] in routing table setting : ${error}`);
                            return;
                        }
                        if (stdout) {
                            console.log(`stdout: ${stdout}`);
                            if (local_mqtt_client !== null) {
                                local_mqtt_client.publish(local_pub_ready_topic, 'ready', () => {
                                    console.log('send ready message to localhost(' + local_pub_ready_topic + ')-', 'ready');
                                });
                            }
                            IPready.status = 'ready';
                            fs.writeFileSync('../readyIP.json', JSON.stringify(IPready, null, 4), 'utf8');
                        }
                        if (stderr) {
                            console.error(`stderr: ${stderr}`);
                        }
                    });
                });
            }
        } else {
            setTimeout(setIPandRoute, 500, drone_ip);
        }
    } else {
        setTimeout(setIPandRoute, 500, drone_ip);
    }
}
