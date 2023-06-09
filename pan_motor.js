const mqtt = require('mqtt');
const { nanoid } = require("nanoid");
const { SerialPort } = require('serialport');

// ---------- set values ---------- 
const PAN_CAN_ID = '000000010000';

// Value limits ------
const P_MIN = -12.500;
const P_MAX = 12.500;
const V_MIN = -65.000;
const V_MAX = 65.000;
const KP_MIN = 0.000;
const KP_MAX = 500.000;
const KD_MIN = 0.000;
const KD_MAX = 5.000;
const T_MIN = -18.000;
const T_MAX = 18.000;
// -------------------

let p_offset = 0.24;

let p_in = 0.000 + p_offset;
let v_in = 0.000;
let kp_in = 20.000;
let kd_in = 1.000;
let t_in = 0.000;

let p_out = 0.000;
let v_out = 0.000;
let t_out = 0.000;

let p_step = 0.005;
let p_target = 0.0;

let cw = 0;
let ccw = 0;
let cur_angle = 0;
let temp_angle = 0;
let turn_angle = 0.0;
let target_angle = 0.0;

let motormode = 2;
let run_flag = '';
let exit_mode_counter = 0;
let no_response_count = 0;

let can_port_num = '/dev/ttyAMA1';
// let can_port_num = 'COM5';
let can_baudrate = '115200';
let can_port = null;

let local_mqtt_host = '127.0.0.1';
let localmqtt = '';

let localmqtt_message = '';
let motor_control_message = '';
let motor_altitude_message = '';
let tracker_location_msg = '';
let tracker_attitude_msg = '';

let myLatitude = 37.4042;
let myLongitude = 127.1608;
let myAltitude = 0.0;
let myRelativeAltitude = 0.0;
let myHeading = 0.0;

let myRoll = 0.0;
let myPitch = 0.0;
let myYaw = 0.0;

let target_latitude = '';
let target_longitude = '';
let target_altitude = '';
let target_relative_altitude = '';

let motor_return_msg = '';

let sub_drone_data_topic = '/RF/TELE_HUB/drone';
let sub_motor_control_topic = '/Ant_Tracker/Control';
let sub_motor_altitude_topic = '/Ant_Tracker/Altitude';
let sub_gps_location_topic = '/GPS/location';
let sub_gps_attitude_topic = '/GPS/attitude';

let pub_motor_position_topic = '/Ant_Tracker/Motor_Pan';

let sitl_state = false;
let sitl_mqtt_host = 'gcs.iotocean.org';
let sitlmqtt = '';

let sitlmqtt_message = '';
let sub_sitl_drone_data_topic = '/Mobius/KETI_GCS/Drone_Data/KETI_Simul_1';

//------------- Can communication -------------
function canPortOpening() {
    if (can_port == null) {
        can_port = new SerialPort({
            path: can_port_num,
            baudRate: parseInt(can_baudrate, 10),
        });

        can_port.on('open', canPortOpen);
        can_port.on('close', canPortClose);
        can_port.on('error', canPortError);
        can_port.on('data', canPortData);
    } else {
        if (can_port.isOpen) {
            can_port.close();
            can_port = null;
            setTimeout(canPortOpening, 2000);
        } else {
            can_port.open();
        }
    }
}

function canPortOpen() {
    console.log('canPort open. ' + can_port_num + ' Data rate: ' + can_baudrate);
}

function canPortClose() {
    console.log('[pan] canPort closed.');

    setTimeout(canPortOpening, 2000);
}

function canPortError(error) {
    let error_str = error.toString();
    console.log('[pan] canPort error: ' + error.message);
    if (error_str.substring(0, 14) == "Error: Opening") {

    } else {
        console.log('[pan] canPort error : ' + error);
    }

    setTimeout(canPortOpening, 2000);
}

let _msg = '';
function canPortData(data) {
    _msg += data.toString('hex').toLowerCase();

    if (_msg.length >= 24) {
        if (_msg.substring(0, 10) === '0000000001') {
            motor_return_msg = _msg.substring(0, 24);
            _msg = _msg.substring(24, _msg.length);
            // console.log('motor_return_msg: ', motor_return_msg);
        }
    }
}

//---------------------------------------------------

//------------- local mqtt connect ------------------
function localMqttConnect(host) {
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
        queueQoSZero: false,
        connectTimeout: 2000,
        rejectUnauthorized: false
    }

    localmqtt = mqtt.connect(connectOptions);

    localmqtt.on('connect', function () {
        localmqtt.subscribe(sub_drone_data_topic + '/#', () => {
            console.log('[pan] localmqtt subscribed -> ', sub_drone_data_topic);
        });
        localmqtt.subscribe(sub_gps_location_topic + '/#', () => {
            console.log('[pan] localmqtt subscribed -> ', sub_gps_location_topic);
        });
        localmqtt.subscribe(sub_gps_attitude_topic + '/#', () => {
            console.log('[pan] localmqtt subscribed -> ', sub_gps_attitude_topic);
        });
        localmqtt.subscribe(sub_motor_control_topic + '/#', () => {
            console.log('[pan] localmqtt subscribed -> ', sub_motor_control_topic);
        });
        localmqtt.subscribe(sub_motor_altitude_topic + '/#', () => {
            console.log('[pan] localmqtt subscribed -> ', sub_motor_altitude_topic);
        });
    });

    localmqtt.on('message', function (topic, message) {
        // console.log('topic, message => ', topic, message);

        if (topic == sub_motor_control_topic) { // 모터 제어 메세지 수신
            motor_control_message = message.toString();
            // console.log(topic, motor_control_message);
        } else if (topic == sub_motor_altitude_topic) {
            motor_altitude_message = message.toString();
            if (typeof (parseInt(motor_altitude_message)) === 'number') {
                myRelativeAltitude = motor_altitude_message;
            }
        } else if (topic.includes(sub_drone_data_topic)) { // 드론데이터 수신
            localmqtt_message = message.toString('hex');
            // console.log("Client1 topic => " + topic);
            // console.log("Client1 message => " + drone_message);

            try {
                let ver = localmqtt_message.substring(0, 2);
                let sysid = '';
                let msgid = '';
                let base_offset = 0;

                if (ver == 'fd') {//MAV ver.1
                    sysid = localmqtt_message.substring(10, 12).toLowerCase();
                    msgid = localmqtt_message.substring(18, 20) + localmqtt_message.substring(16, 18) + localmqtt_message.substring(14, 16);
                    base_offset = 20;
                } else { //MAV ver.2
                    sysid = localmqtt_message.substring(6, 8).toLowerCase();
                    msgid = localmqtt_message.substring(10, 12).toLowerCase();
                    base_offset = 12;
                }

                let sys_id = parseInt(sysid, 16);
                let msg_id = parseInt(msgid, 16);

                if (msg_id === 33) { // MAVLINK_MSG_ID_GLOBAL_POSITION_INT
                    var time_boot_ms = localmqtt_message.substring(base_offset, base_offset + 8).toLowerCase()
                    base_offset += 8
                    let lat = localmqtt_message.substring(base_offset, base_offset + 8).toLowerCase().toString();
                    base_offset += 8;
                    let lon = localmqtt_message.substring(base_offset, base_offset + 8).toLowerCase();
                    base_offset += 8;
                    let alt = localmqtt_message.substring(base_offset, base_offset + 8).toLowerCase();
                    base_offset += 8;
                    let relative_alt = localmqtt_message.substring(base_offset, base_offset + 8).toLowerCase();

                    target_latitude = Buffer.from(lat, 'hex').readInt32LE(0).toString() / 10000000;
                    target_longitude = Buffer.from(lon, 'hex').readInt32LE(0).toString() / 10000000;
                    target_altitude = Buffer.from(alt, 'hex').readInt32LE(0).toString() / 1000;
                    target_relative_altitude = Buffer.from(relative_alt, 'hex').readInt32LE(0).toString() / 1000;

                    // calcTargetPanAngle(target_latitude, target_longitude);
                    // console.log('target_latitude, target_longitude, target_altitude, target_relative_altitude', target_latitude, target_longitude, target_altitude, target_relative_altitude);
                }
            }
            catch (e) {
                console.log('[pan] local mqtt connect Error', e);
            }
        } else if (topic === sub_gps_location_topic) { // 픽스호크로부터 받아오는 트래커 위치 좌표
            tracker_location_msg = JSON.parse(message.toString());
            myLatitude = tracker_location_msg.lat;
            myLongitude = tracker_location_msg.lon;
            myAltitude = tracker_location_msg.alt;
            myRelativeAltitude = tracker_location_msg.relative_alt;
            // myHeading = tracker_location_msg.hdg;

            myHeading = Math.round(tracker_location_msg.hdg)+13;
            if (myHeading > 180){
                myHeading = myHeading - 360;
            }
            // console.log('tracker_location_msg: ', myLatitude, myLongitude, myRelativeAltitude, myHeading);
        } else if (topic === sub_gps_attitude_topic) {
            tracker_attitude_msg = JSON.parse(message.toString());
            myRoll = tracker_attitude_msg.roll;
            myPitch = tracker_attitude_msg.pitch;
            myYaw = tracker_attitude_msg.yaw;
            // console.log('tracker_location_msg: ', myRoll, myPitch, myYaw);
        }
    });

    localmqtt.on('error', function (err) {
        console.log('[pan] local mqtt connect error ' + err.message);
        localmqtt = null;
        setTimeout(localMqttConnect, 1000, local_mqtt_host);
    });

    runMotor();
    setInterval(()=>{
        console.log(calcTargetPanAngle(target_latitude, target_longitude));
    },500)

}
//---------------------------------------------------

function runMotor() {
    setTimeout(() => {
        motor_control_message = 'init';
    }, 3000);

    setTimeout(() => {
        setInterval(() => {
            if (motor_control_message == 'on') {
                EnterMotorMode();
                motormode = 1;
                motor_control_message = '';
            }
            else if (motor_control_message == 'off') {
                ExitMotorMode();
                motormode = 0;
                motor_control_message = '';
                run_flag = '';
            }
            else if (motor_control_message == 'zero') {
                Zero();
                p_in = 0 + p_offset;
                motor_control_message = '';
            }
            else if (motor_control_message == 'init') {
                if (motormode !== 1) {
                    motormode = 1;
                    // initAction();
                    motor_control_message = 'zero';
                    EnterMotorMode();
                } else {
                    // initAction();
                    motor_control_message = 'zero';
                }
            }

            if (motormode === 1) {
                if (motor_control_message == 'pan_up') {
                    p_in = p_in + p_step;
                }
                else if (motor_control_message == 'pan_down') {
                    p_in = p_in - p_step;
                }
                else if (motor_control_message == 'stop') {
                    motor_control_message = '';
                    run_flag = '';
                }
                else if (motor_control_message.includes('go')) {
                    p_target = (parseInt(motor_control_message.toString().replace('go', '')) * 0.0174533) + p_offset;

                    if (p_target < p_in) {
                        p_in = p_in - p_step;
                    }
                    else if (p_target > p_in) {
                        p_in = p_in + p_step;
                    }
                }
                else if (motor_control_message == 'run') {
                    target_angle = calcTargetPanAngle(target_latitude, target_longitude);
                    console.log('myHeading, target_angle', myHeading, target_angle);
                    run_flag = 'go';

                    if (Math.abs(target_angle - myHeading) > 15) {
                        p_step = 0.015;
                    } else if (Math.abs(target_angle - myHeading) > 10) {
                        p_step = 0.008;
                    } else if (Math.abs(target_angle - myHeading) > 5) {
                        p_step = 0.004;
                    } else {
                        p_step = 0.001;
                    }

                    if (myHeading !== target_angle) {
                        cw = target_angle - myHeading;
                        if (cw < 0) {
                            cw = cw + 360;
                        }
                        ccw = 360 - cw;

                        if (cw < ccw) {
                            p_in = p_in + p_step;
                        } else if (cw > ccw) {
                            p_in = p_in - p_step;
                        } else {
                            p_in = p_in;
                        }
                    }
                    p_step = 0.02;
                }

                p_in = constrain(p_in, P_MIN, P_MAX);

                pack_cmd();

                no_response_count++;

                if (motor_return_msg !== '') {
                    unpack_reply();
                    no_response_count = 0;

                    motor_return_msg = '';
                    // console.log('[pan] -> + ', p_target, p_in, p_out, v_out, t_out);
                }
            } else if (motormode === 2) {
                ExitMotorMode();

                if (motor_return_msg !== '') {
                    unpack_reply();
                    exit_mode_counter++;

                    motor_return_msg = '';
                    p_in = p_out + p_offset;

                    console.log('[pan] ExitMotorMode', p_in, p_out, v_out, t_out);
                    if (exit_mode_counter > 5) {
                        motormode = 3;
                        exit_mode_counter = 0;
                    }
                }
            }

            if (no_response_count > 48) {
                console.log('[pan] no_response_count', no_response_count);
                no_response_count = 0;
                motor_return_msg = null;
                motormode = 2;
            }

            try {
                localmqtt.publish(pub_motor_position_topic, myHeading.toString(), () => {
                    // console.log('[pan] send Motor angle to GCS value: ', p_out * 180 / Math.PI)
                });
            } catch {
            }
        }, 20);
    }, 1000);

}

let constrain = (_in, _min, _max) => {
    if (_in < _min) {
        return _min;
    }
    else if (_in > _max) {
        return _max;
    }
    else {
        return _in;
    }
}

let initAction = () => {
    setTimeout(() => {
        motor_control_message = 'zero';

        setTimeout(() => {
            if (myHeading !== 0) {
                if (myHeading > 180) {
                    motor_control_message = 'go' + (myHeading - 360);
                }
                else if (myHeading < 180) {
                    motor_control_message = 'go' + myHeading * (-1);
                }
                setTimeout(() => {
                    motor_control_message = 'zero';
                }, 10000);
            }


            // setTimeout(() => {
            //     motor_control_message = 'pan_down';

            //     setTimeout(() => {
            //         motor_control_message = 'stop';
            //     }, 2000);
            // }, 2000);
        }, 1000);
    }, 500);
}

let float_to_uint = (x, x_min, x_max, bits) => {
    let span = x_max - x_min;
    let offset = x_min;
    let pgg = 0;
    if (bits === 12) {
        pgg = (x - offset) * 4095.0 / span;
    }
    else if (bits === 16) {
        pgg = (x - offset) * 65535.0 / span;
    }

    return parseInt(pgg);
}

let uint_to_float = (x_int, x_min, x_max, bits) => {
    let span = x_max - x_min;
    let offset = x_min;
    let pgg = 0;
    if (bits === 12) {
        pgg = parseFloat(x_int) * span / 4095.0 + offset;
    }
    else if (bits === 16) {
        pgg = parseFloat(x_int) * span / 65535.0 + offset;
    }

    return parseFloat(pgg);
}

function pack_cmd() {
    let p_des = constrain(p_in, P_MIN, P_MAX);
    let v_des = constrain(v_in, V_MIN, V_MAX);
    let kp = constrain(kp_in, KP_MIN, KP_MAX);
    let kd = constrain(kd_in, KD_MIN, KD_MAX);
    let t_ff = constrain(t_in, T_MIN, T_MAX);

    let p_int = float_to_uint(p_des, P_MIN, P_MAX, 16);
    let v_int = float_to_uint(v_des, P_MIN, P_MAX, 12);
    let kp_int = float_to_uint(kp, P_MIN, P_MAX, 12);
    let kd_int = float_to_uint(kd, P_MIN, P_MAX, 12);
    let t_int = float_to_uint(t_ff, T_MIN, T_MAX, 12);

    let p_int_hex = p_int.toString(16).padStart(4, '0');
    let v_int_hex = v_int.toString(16).padStart(3, '0');
    let kp_int_hex = kp_int.toString(16).padStart(3, '0');
    let kd_int_hex = kd_int.toString(16).padStart(3, '0');
    let t_int_hex = t_int.toString(16).padStart(3, '0');

    let msg_buf = PAN_CAN_ID + p_int_hex + v_int_hex + kp_int_hex + kd_int_hex + t_int_hex;
    //console.log('Can Port Send Data ===> ' + msg_buf);

    can_port.write(Buffer.from(msg_buf, 'hex'), () => {
        // console.log('can write =>', msg_buf);
    }, 10);
}

let unpack_reply = () => {
    try {
        let id = parseInt(motor_return_msg.substring(9, 10), 16);
        if (id === 1) {
            let p_int = parseInt(motor_return_msg.substring(10, 14), 16);
            let v_int = parseInt(motor_return_msg.substring(14, 17), 16);
            let i_int = parseInt(motor_return_msg.substring(17, 20), 16);

            p_out = uint_to_float(p_int, P_MIN, P_MAX, 16);
            v_out = uint_to_float(v_int, V_MIN, V_MAX, 12);
            t_out = uint_to_float(i_int, T_MIN, T_MAX, 12);
        }
    } catch {

    }
}

//--------------- CAN special message ---------------
function EnterMotorMode() {
    can_port.write(Buffer.from(PAN_CAN_ID + 'FFFFFFFFFFFFFFFC', 'hex'), () => {
        // console.log(PAN_CAN_ID + 'FFFFFFFFFFFFFFFC');
    });
}

function ExitMotorMode() {
    can_port.write(Buffer.from(PAN_CAN_ID + 'FFFFFFFFFFFFFFFD', 'hex'), () => {
        // console.log(PAN_CAN_ID + 'FFFFFFFFFFFFFFFD');
    });
}

function Zero() {
    can_port.write(Buffer.from(PAN_CAN_ID + 'FFFFFFFFFFFFFFFE', 'hex'), () => {
        // console.log(PAN_CAN_ID + 'FFFFFFFFFFFFFFFE');
    });
}
//---------------------------------------------------

function calcTargetPanAngle(targetLatitude, targetLongitude) {
    console.log('[pan] myLatitude, myLongitude, myRelativeAltitude: ', myLatitude, myLongitude, myRelativeAltitude);
    console.log('[pan] targetLatitude, targetLongitude: ', targetLatitude, targetLongitude);

    let radmyLatitude = myLatitude * Math.PI / 180;
    let radTargetLatitude = targetLatitude * Math.PI / 180;
    let radMyLongitude = myLongitude * Math.PI / 180;
    let radTargetLongitude = targetLongitude * Math.PI / 180;

    let y = Math.sin(radTargetLongitude - radMyLongitude) * Math.cos(radTargetLatitude);
    let x = Math.cos(radmyLatitude) * Math.sin(radTargetLatitude) - Math.sin(radmyLatitude) * Math.cos(radTargetLatitude) * Math.cos(radTargetLongitude - radMyLongitude);
    let angle = Math.atan2(y, x); // azimuth angle (radians)

    angle = (angle + p_offset) * 180 / Math.PI;
    return Math.round(angle);

    // let turn_target = Math.round((angle + p_offset) * 50) / 50;  // 0.5단위 반올림
    // turn_angle = (turn_target * 180 / Math.PI + 360) % 360; // azimuth angle (convert to degree)

    // turn_angle = turn_angle - myHeading;
    // if (run_flag === 'reset') {
    //     run_flag = 'go';
    //     motor_control_message = 'run';
    // }
    // else if (run_flag === 'go') {
    //     if (parseInt(Math.abs(cur_angle)) === 360) {
    //         motor_control_message = 'zero';
    //         cur_angle = 0;
    //         run_flag = 'reset';
    //     }

    //     if (turn_angle < 0) {
    //         temp_angle = turn_angle + 360;
    //     }
    //     else {
    //         temp_angle = turn_angle;
    //     }

    //     if (temp_angle - cur_angle < 0) {
    //         cw = 360 - cur_angle + temp_angle;
    //         ccw = (360 - cw) * (-1);
    //     }
    //     else {
    //         if (temp_angle - cur_angle >= 360) {
    //             cw = temp_angle - cur_angle - 360;
    //             ccw = (360 - cw) * (-1);
    //         }
    //         else {
    //             cw = temp_angle - cur_angle;
    //             ccw = (360 - cw) * (-1);
    //         }
    //     }

    //     if (Math.abs(cw) <= Math.abs(ccw)) {
    //         p_target = (cur_angle + cw) * 0.0174533 + p_offset;
    //     }
    //     else {
    //         p_target = (cur_angle + ccw) * 0.0174533 + p_offset;
    //     }
    //     cur_angle = (p_target - p_offset) * 180 / Math.PI;

    //     // console.log('-------------------------------');
    //     // console.log('turnAngle: ', turnAngle);
    //     // console.log('cur_angle: ', cur_angle);
    //     // console.log('temp_angle: ', temp_angle);
    //     // console.log('cw, ccw: ', cw, ccw);
    //     // console.log('p_target: ', p_target);
    //     // console.log('-------------------------------');
    // }
}

//------------- sitl mqtt connect ------------------
function sitlMqttConnect(host) {
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

    sitlmqtt = mqtt.connect(connectOptions);

    sitlmqtt.on('connect', function () {
        sitlmqtt.subscribe(sub_sitl_drone_data_topic + '/#', () => {
            console.log('[pan] sitl mqtt subscribed -> ', sub_sitl_drone_data_topic);
        });
    });

    sitlmqtt.on('message', function (topic, message) {
        // console.log('[sitl] topic, message => ', topic, message);

        if (topic.includes(sub_sitl_drone_data_topic)) {
            sitlmqtt_message = message.toString('hex');
            // console.log("Client1 topic => " + topic);
            // console.log("Client1 message => " + sitlmqtt_message);

            try {
                let ver = sitlmqtt_message.substring(0, 2);
                let sysid = '';
                let msgid = '';
                let base_offset = 0;

                if (ver == 'fd') {//MAV ver.1
                    sysid = sitlmqtt_message.substring(10, 12).toLowerCase();
                    msgid = sitlmqtt_message.substring(18, 20) + sitlmqtt_message.substring(16, 18) + sitlmqtt_message.substring(14, 16);
                    base_offset = 28;
                } else { //MAV ver.2
                    sysid = sitlmqtt_message.substring(6, 8).toLowerCase();
                    msgid = sitlmqtt_message.substring(10, 12).toLowerCase();
                    base_offset = 20;
                }

                let sys_id = parseInt(sysid, 16);
                let msg_id = parseInt(msgid, 16);

                if (msg_id === 33) { // MAVLINK_MSG_ID_GLOBAL_POSITION_INT
                    let lat = sitlmqtt_message.substring(base_offset, base_offset + 8).toLowerCase().toString();
                    base_offset += 8;
                    let lon = sitlmqtt_message.substring(base_offset, base_offset + 8).toLowerCase();
                    base_offset += 8;
                    let alt = sitlmqtt_message.substring(base_offset, base_offset + 8).toLowerCase();
                    base_offset += 8;
                    let relative_alt = sitlmqtt_message.substring(base_offset, base_offset + 8).toLowerCase();

                    target_latitude = Buffer.from(lat, 'hex').readInt32LE(0).toString() / 10000000;
                    target_longitude = Buffer.from(lon, 'hex').readInt32LE(0).toString() / 10000000;
                    target_altitude = Buffer.from(alt, 'hex').readInt32LE(0).toString() / 1000;
                    target_relative_altitude = Buffer.from(relative_alt, 'hex').readInt32LE(0).toString() / 1000;
                    // calcTargetPanAngle(target_latitude, target_longitude);
                    // console.log('target_latitude, target_longitude, target_altitude, target_relative_altitude', target_latitude, target_longitude, target_altitude, target_relative_altitude);

                }

            }
            catch (e) {
                console.log('[pan] SITL Mqtt connect Error', e);
            }
        }
    });

    sitlmqtt.on('error', function (err) {
        console.log('[pan] SITL mqtt connect error ' + err.message);
        sitlmqtt = null;
        setTimeout(sitlMqttConnect, 1000, sitl_mqtt_host);
    });
}
//---------------------------------------------------

canPortOpening();
localMqttConnect(local_mqtt_host);
if (sitl_state === true) {
    sitlMqttConnect(sitl_mqtt_host);

}
