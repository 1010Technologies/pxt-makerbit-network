const enum NetworkConnection {
  //% block="None"
  NONE = 0,
  //% block="ESP device"
  ESP = 1,
  //% block="WiFi"
  WIFI = 2,
  //% block="Internet"
  INTERNET = 3,
  //% block="project and group"
  PROJECT_GROUP = 4,
}

const enum TimeZone {
  //% block="UTC"
  UTC,
  //% block="America Los Angeles"
  America_Los_Angeles,
  //% block="Europe Berlin"
  Europe_Berlin,
  America_New_York,
  Asia_Tokyo
}


//% color=#0fbc11 icon="\u272a" block="MakerBit"
//% category="MakerBit"
namespace makerbit {

  /**
    * Turns a time zone id into a string that describes the timezone.
    */
  //% blockId=makerbit_helper_timezone
  //% block="%timezone"
  //% blockHidden=true
  export function timezone(timezone: TimeZone): string {
    // https://github.com/esp8266/Arduino/blob/master/cores/esp8266/TZ.h
    switch (timezone) {
      case TimeZone.America_Los_Angeles: return "PST8PDT,M3.2.0,M11.1.0";
      case TimeZone.Europe_Berlin: return "CET-1CEST,M3.5.0,M10.5.0/3";
      case TimeZone.America_New_York: return "TZ_America_New_York";
      case TimeZone.Asia_Tokyo: return "JST-9";
      default:
        return "UTC0";
    }
  }

  export namespace net {
    interface Clock {
      time: string;
      date: string;
      weekday: number;
      timeZone: string;
      lastTimeUpdate: number;
    }

    interface EspState {
      subscriptions: Subscription[];
      lastError: number;
      project: string;
      group: string;
      connection: number;
      notifiedConnection: number;
      device: string;
      espRX: DigitalPin;
      espTX: DigitalPin;
      ssid: string;
      wiFiPassword: string;
      obtainDeviceJobId: number;
      obtainConnectionStatusJobId: number;
      transmissionControl: boolean;
      clock: Clock;
      hasSubscriptionUpdate: boolean;
    }

    const STRING_TOPIC = "s_";
    const NUMBER_TOPIC = "n_";
    const LED_TOPIC = "l_";
    const CONNECTION_TOPIC = "$ESP/connection";
    const DEVICE_TOPIC = "$ESP/device";
    const ERROR_TOPIC = "$ESP/error";
    const DATETIME_TOPIC = "$ESP/date-time";
    const TRANSMISSION_CONTROL_TOPIC = "$ESP/tc";
    const INVALID_DEVICE_VERSION = "0.0.0";

    let espState: EspState = undefined;

    let serialWriteString = (text: string) => {
      serial.writeStringBlocking(text);
    };

    function normalize(value: string): string {
      if (!value) {
        return "";
      }
      return value.replaceAll(" ", "").replaceAll("/", "").replaceAll("\"", "");
    }

    function publish(topic: string, value: string): void {
      const msg = ["pub ", normalize(topic), ' "', "" + value.replaceAll("\"", ""), '"\n'].join("");
      serialWriteString(msg);
    }

    function subscribe(normalizedTopic: string): void {
      const msg = ["sub ", normalizedTopic, '"\n'].join("");
      serialWriteString(msg);
    }

    class Subscription {
      topic: string;
      value: string;
      handler: (value: string | number | Image) => void;

      constructor(
        topic: string,
        handler: (value: string | number | Image) => void
      ) {
        this.value = "";
        this.topic = topic;
        this.handler = handler;
      }

      setValue(value: string) {
        this.value = value;
      }

      notifyUpdate() {
        if (!this.value.isEmpty()) {
          let decodedValue: string | number | Image = this.value;

          if (this.topic == LED_TOPIC) {
            decodedValue = decodeImage(parseInt(this.value));
          }

          this.value = "";
          this.handler(decodedValue);
        }
      }
    }

    function notifySubscriptionUpdates(): void {
      if (!espState.hasSubscriptionUpdate) {
        return;
      }
      espState.hasSubscriptionUpdate = false;
      espState.subscriptions.forEach((subscription) => {
        subscription.notifyUpdate();
      });
    }

    function getFirstToken(data: string): string {
      const spaceIdx = data.indexOf(" ");

      if (spaceIdx < 0) {
        return data;
      } else {
        return data.substr(0, spaceIdx);
      }
    }

    function applyTopicUpdate(topic: string, value: string): boolean {
      let isExpectedTopic = false;

      if (topic.indexOf("$ESP/") === 0) {
        isExpectedTopic = true;

        if (topic === CONNECTION_TOPIC) {
          espState.connection = parseInt(getFirstToken(value));
        } else if (topic === ERROR_TOPIC) {
          espState.lastError = parseInt(getFirstToken(value));
        } else if (topic === DEVICE_TOPIC) {
          espState.device = getFirstToken(value);
        } else if (topic === TRANSMISSION_CONTROL_TOPIC) {
          espState.transmissionControl = value === "1";
        } else if (topic === DATETIME_TOPIC) {
          if (espState.clock) {
            const dateTime = value.split(" ");
            if (dateTime.length == 3) {
              espState.clock.lastTimeUpdate = control.millis();
              espState.clock.date = dateTime[0];
              espState.clock.time = dateTime[1];
              espState.clock.weekday = parseInt(dateTime[2]);
            }
          }
        }
      }

      espState.subscriptions.forEach((subscription) => {
        if (topic === subscription.topic) {
          isExpectedTopic = true;
          subscription.setValue(value);
          espState.hasSubscriptionUpdate = true;
        }
      });

      return isExpectedTopic;
    }

    function splitSerialMessage(
      message: string,
      removeTransmissionIdFromContent: boolean
    ): string[] {
      const contentIdx = message.indexOf(" ");
      const idIdx = message.indexOf(" ", message.length - 4);

      if (contentIdx < 0) {
        return [message, "", "0"];
      }

      const hasId = idIdx > 0 && idIdx > contentIdx;

      const data = [];

      // Add topic
      data.push(message.substr(0, contentIdx));

      // Add content
      if (hasId && removeTransmissionIdFromContent) {
        data.push(message.substr(contentIdx + 1, idIdx - contentIdx - 1));
      } else {
        data.push(
          message.substr(contentIdx + 1, message.length - contentIdx - 1)
        );
      }

      // Add transmission ID
      if (hasId) {
        data.push(message.substr(idIdx + 1, 3));
      } else {
        data.push("0");
      }

      return data;
    }

    function processSerialMessage(message: string): void {
      const data = splitSerialMessage(message, espState.transmissionControl);

      const isExpectedTopic = applyTopicUpdate(data[0], data[1]);

      if (isExpectedTopic && espState.transmissionControl) {
        const msg = ["ack ", data[2], "\n"].join("");
        serialWriteString(msg);
      }
    }

    function readSerialMessages(): void {
      let message: string = "";

      while (true) {
        while (serial.available() > 0) {
          const r = serial.read();
          if (r != -1) {
            if (r == Delimiters.NewLine) {
              processSerialMessage(message);
              message = "";
            } else {
              if (message.length < 256) {
                message = message.concat(String.fromCharCode(r));
              } else {
                message = "";
                const errorSub = espState.subscriptions.find(sub => sub.topic === ERROR_TOPIC);
                if (errorSub) {
                  errorSub.setValue("71");
                  espState.hasSubscriptionUpdate = true;
                }
                espState.lastError = 71;
              }
            }
          }
        }
        basic.pause(5);
      }
    }

    /**
     * Registers code to run when the micro:bit receives a string.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_on_receive_string"
    //% block="on network received"
    //% draggableParameters=reporter
    //% weight=49
    //% blockHidden=true
    export function onReceivedString(
      handler: (receivedString: string) => void
    ): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(STRING_TOPIC, handler));
      subscribe(STRING_TOPIC);
    }

    /**
     * Do something when the micro:bit receives a number.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_on_receive_number"
    //% block="on network received"
    //% draggableParameters=reporter
    //% weight=50
    //% blockHidden=true
    export function onReceivedNumber(
      handler: (receivedNumber: number) => void
    ): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(NUMBER_TOPIC, handler));
      subscribe(NUMBER_TOPIC);
    }

    /**
     * Do something when the micro:bit receives a screenshot.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_on_receive_screenshot"
    //% block="on network received"
    //% draggableParameters=reporter
    //% weight=48
    export function onReceivedScreenshot(
      handler: (receivedScreenshot: Image) => void
    ): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(LED_TOPIC, handler));
      subscribe(LED_TOPIC);
    }

    /**
     * Do something when the micro:bit receives a number in a channel.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_on_receive_number_in_channel"
    //% block="on network received in channel %channel"
    //% draggableParameters=reporter
    //% weight=47
    export function onReceivedNumberInChannel(
      channel: string,
      handler: (receivedNumber: number) => void
    ): void {
      autoConnectToESP();
      const topic = NUMBER_TOPIC + normalize(channel);
      espState.subscriptions.push(new Subscription(topic, handler));
      subscribe(topic);
    }

    /**
     * Do something when the micro:bit receives a string in a channel.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_on_receive_string_in_channel"
    //% block="on network received in channel %channel"
    //% draggableParameters=reporter
    //% weight=46
    export function onReceivedStringInChannel(
      channel: string,
      handler: (receivedString: string) => void
    ): void {
      autoConnectToESP();
      const topic = STRING_TOPIC + normalize(channel);
      espState.subscriptions.push(new Subscription(topic, handler));
      subscribe(topic);
    }

    /**
     * Do something when the ESP notifies an error.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_on_error"
    //% block="on network error"
    //% weight=29
    export function onError(handler: () => void): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(ERROR_TOPIC, handler));
    }

    /**
     * Do something when the connection level changes.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_on_connection"
    //% block="on network connection"
    //% weight=30
    export function onConnection(handler: () => void): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(CONNECTION_TOPIC, handler));
    }

    function requestDateTimeUpdate(): void {
      if (espState.clock) {
        const msg = ["date-time ", espState.clock.timeZone, " 600\n"].join("");
        serialWriteString(msg);
      }
    }

    function toSeconds(timeString: string): number {
      const time = timeString.split(":");
      return (
        parseInt(time[0]) * 3600 + parseInt(time[1]) * 60 + parseInt(time[2])
      );
    }

    function toTwoDigitString(value: number): string {
      if (value < 10) {
        return "0" + value;
      } else {
        return "" + value;
      }
    }

    function toTime(timeInSeconds: number): string {
      const seconds = timeInSeconds % 60;
      const minutes = Math.idiv(timeInSeconds - seconds, 60) % 60;
      const hours = Math.idiv(timeInSeconds - seconds - minutes * 60, 3600);
      return [
        toTwoDigitString(hours),
        toTwoDigitString(minutes),
        toTwoDigitString(seconds),
      ].join(":");
    }

    function calculateTime(): string {
      if (!espState || !espState.clock || espState.clock.date === "0000-00-00") {
        return "00:00:00";
      }

      const refSecs = toSeconds(espState.clock.time);
      const deltaUpdateSecs = Math.idiv(
        control.millis() - espState.clock.lastTimeUpdate,
        1000
      );
      const newSecs = (refSecs + deltaUpdateSecs) % (24 * 60 * 60);
      return toTime(newSecs);
    }

    function initClock(timeZone: string = null) {
      if (!espState.clock) {
        espState.clock = {
          time: "00:00:00",
          date: "0000-00-00",
          weekday: 0,
          timeZone: timeZone ? timeZone : "UTC0",
          lastTimeUpdate: -1,
        };
      }
      if (espState.clock.lastTimeUpdate < 0) {
        requestDateTimeUpdate();
      }
    }

    /**
     * Returns the time.
     */
    //% subcategory="Time"
    //% blockId=makerbit_network_time
    //% block="time"
    //% weight=54
    export function getTime(): string {
      autoConnectToESP();
      initClock();
      return calculateTime();
    }

    /**
     * Returns the date.
     */
    //% subcategory="Time"
    //% blockId=makerbit_network_date
    //% block="date"
    //% weight=53
    export function getDate(): string {
      autoConnectToESP();
      initClock();
      return espState.clock.date;
    }

    /**
     * Returns the weekday as a decimal number, where 0 is Sunday and 6 is Saturday.
     */
    //% subcategory="Time"
    //% blockId=makerbit_network_weekday
    //% block="weekday"
    //% weight=54
    export function getWeekday(): number {
      autoConnectToESP();
      initClock();
      return espState.clock.weekday;
    }

    function offsetToTimeZone(hours: number, minutes: number): string {
      // e.g. Kabul <+0430>-4:30
      const pos = hours >= 0;
      hours = Math.abs(Math.trunc(hours));
      minutes = Math.abs(Math.trunc(minutes));

      const tz = [
        '<',
        pos ? '+' : '-',
        toTwoDigitString(hours),
        toTwoDigitString(minutes),
        '>',
        pos ? '-' : '+',
        toTwoDigitString(hours),
        ':',
        toTwoDigitString(minutes),
      ].join("");

      return tz;
    }

    /**
     * Sets the time zone with an offset from UTC.
     */
    //% subcategory="Time"
    //% blockId=makerbit_network_set_time_zone_with_utc_offset
    //% block="set time zone to UTC offset of %hours hours and %minutes minutes"
    //% hours.min=-12 hours.max=14
    //% minutes.min=0 minutes.max=59
    //% weight=56
    export function setTimeZoneWithUtcOffset(hours: number, minutes: number): void {
      setTimeZone(offsetToTimeZone(hours, minutes));
    }


    /**
     * Sets the time zone.
     */
    //% subcategory="Time"
    //% blockId=makerbit_network_set_time_zone
    //% block="set time zone to %timezone=makerbit_helper_timezone"
    //% weight=55
    export function setTimeZone(timeZone: string): void {
      autoConnectToESP();
      initClock(timeZone);
      espState.clock.timeZone = timeZone;
      requestDateTimeUpdate();
    }


    /**
     * Configures the WiFi connection.
     * @param ssid network name
     * @param password password
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_connect_wifi"
    //% block="network connect to WiFi network %ssid | and password %password"
    //% weight=96
    export function connectWiFi(ssid: string, password: string): void {
      autoConnectToESP();
      espState.ssid = ssid;
      espState.wiFiPassword = password;
      setWiFi();
    }

    function setWiFi() {
      const msg = [
        'wifi "',
        espState.ssid,
        '" "',
        espState.wiFiPassword,
        '"\n',
      ].join("");
      serialWriteString(msg);
    }

    function getDeviceAndConnectionStatus(): void {
      // poll for device version
      espState.obtainDeviceJobId = background.schedule(
        () => {
          if (espState.device === INVALID_DEVICE_VERSION) {
            serialWriteString("device\n");
          } else {
            background.remove(background.Thread.Priority, espState.obtainDeviceJobId);

            // poll for intial connection status
            espState.obtainConnectionStatusJobId = background.schedule(
              () => {
                if (espState.connection <= NetworkConnection.NONE) {
                  serialWriteString("connection-status\n");
                } else {
                  background.remove(background.Thread.Priority, espState.obtainConnectionStatusJobId);
                }
              },
              background.Thread.Priority,
              background.Mode.Repeat,
              1150,
            );
          }
        },
        background.Thread.Priority,
        background.Mode.Repeat,
        1000,
      );
    }

    /**
     * Connects the ESP8266 device to the 3V Analog Grove socket.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_connect_esp_analog_grove_3v"
    //% block="network connect ESP to 3V Analog Grove socket"
    //% weight=99
    export function connectESPtoAnalogGrove3V(): void {
      connectESP(DigitalPin.P0, DigitalPin.P1);
    }

    /**
     * Connects to the ESP8266 device.
     * @param espTx ESP8266 device transmitter pin (TX)
     * @param espRx ESP8266 device receiver pin (RX)
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_connect_esp"
    //% block="network connect with ESP RX attached to %espRX | and ESP TX to %espTX"
    //% espRX.defl=DigitalPin.P0
    //% espRX.fieldEditor="gridpicker"
    //% espRX.fieldOptions.columns=3
    //% espRX.fieldOptions.tooltips="false"
    //% espTX.defl=DigitalPin.P1
    //% espTX.fieldEditor="gridpicker"
    //% espTX.fieldOptions.columns=3
    //% espTX.fieldOptions.tooltips="false"
    //% weight=97
    //% blockHidden=false
    export function connectESP(espRX: DigitalPin, espTX: DigitalPin): void {
      if (control.isSimulator()) {
        serialWriteString = (text: string) => { };
      }

      if (!espState || espState.espRX != espRX || espState.espTX != espTX) {
        serial.setRxBufferSize(32);
        serial.setTxBufferSize(32);

        serial.redirect(
          espRX as number,
          espTX as number,
          BaudRate.BaudRate9600
        );

        // establish clean connection
        while (serial.read() != -1) { }
        serialWriteString("----- -----\n");
      }

      if (!espState) {
        espState = {
          subscriptions: [],
          lastError: 0,
          project: "" + randint(111111111, 999999999),
          group: "1",
          connection: NetworkConnection.NONE,
          notifiedConnection: -1,
          device: INVALID_DEVICE_VERSION,
          espRX: espRX,
          espTX: espTX,
          ssid: "",
          wiFiPassword: "",
          obtainDeviceJobId: 0,
          obtainConnectionStatusJobId: 0,
          transmissionControl: true,
          clock: undefined,
          hasSubscriptionUpdate: false,
        };

        control.runInParallel(readSerialMessages);

        background.schedule(
          notifySubscriptionUpdates,
          background.Thread.Priority,
          background.Mode.Repeat,
          20
        );

        // Always notify connection level NONE in the beginning
        applyTopicUpdate(CONNECTION_TOPIC, "" + NetworkConnection.NONE);

        getDeviceAndConnectionStatus();
      }

      espState.espRX = espRX;
      espState.espTX = espTX;

      setMqttApplicationPrefix();

      if (!espState.ssid.isEmpty()) {
        setWiFi();
      }
    }

    /**
     * Returns the last error code.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_get_last_error"
    //% block="network error"
    //% weight=88
    export function getLastError(): number {
      if (!espState) {
        return 0;
      }
      return espState.lastError;
    }

    /**
     * Returns the ESP device firmware version.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_get_device"
    //% block="network device version"
    //% weight=87
    //% blockHidden=false
    export function getDevice(): string {
      if (!espState) {
        return INVALID_DEVICE_VERSION;
      }
      return espState.device;
    }

    /**
     * Returns the connection level.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_get_connection"
    //% block="network connection"
    //% weight=89
    export function getConnection(): NetworkConnection {
      if (!espState) {
        return NetworkConnection.NONE;
      }
      return espState.connection;
    }

    function autoConnectToESP(): void {
      if (!espState) {
        connectESPtoAnalogGrove3V()
      }
    }

    /**
     * Broadcasts a string to other micro:bits that are connected to the same project.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_send_string"
    //% block="network send string %value"
    //% value.shadowOptions.toString=true
    //% weight=79
    //% blockHidden=true
    export function sendString(value: string): void {
      autoConnectToESP();
      publish(STRING_TOPIC, value);
    }

    /**
     * Broadcasts a number to other micro:bits that are connected to the same project and group.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_send_number"
    //% block="network send number %value"
    //% weight=80
    //% blockHidden=true
    export function sendNumber(value: number): void {
      autoConnectToESP();
      publish(NUMBER_TOPIC, "" + Math.roundWithPrecision(value, 2));
    }

    /**
     * Broadcasts a screenshot to other micro:bits that are connected to the same project and group.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_send_screenshot"
    //% block="network send screenshot"
    //% weight=78
    export function sendScreenshot(): void {
      autoConnectToESP();
      publish(LED_TOPIC, "" + encodeImage(led.screenshot()));
    }

    /**
     * Broadcasts a number via a channel to other micro:bits that are connected to the same project and group.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_send_number_to_channel"
    //% block="network send|number %value || to channel %channel"
    //% expandableArgumentMode="toggle"
    //% weight=80
    export function sendNumberToChannel(value: number, channel?: string): void {
      autoConnectToESP();
      publish(
        NUMBER_TOPIC + normalize(channel),
        "" + Math.roundWithPrecision(value, 2)
      );
    }

    /**
     * Broadcasts a string via a channel to other micro:bits that are connected to the same same project and group.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_send_string_to_channel"
    //% block="network send|string %value || to channel %channel"
    //% expandableArgumentMode="toggle"
    //% weight=79
    export function sendStringToChannel(value: string, channel?: string): void {
      autoConnectToESP();
      publish(STRING_TOPIC + normalize(channel), value);
    }

    /**
     * Sets the project and group for the Internet communications. A micro:bit can be connected to exactly one project and group at any time.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_connect_project_group"
    //% block="network connect to project %project and group %group"
    //% project.defl=123-456-789
    //% project.defl=1
    //% weight=95
    export function connectProjectGroup(project: string, group: string): void {
      autoConnectToESP();
      espState.project = normalize(project);
      espState.group = normalize(group);
      setMqttApplicationPrefix();
    }

    /**
     * Returns true if the specified connection level is reached or exceeded.
     * False otherwise.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_is_connected"
    //% block="network is connected to %state"
    //% weight=92
    export function isConnected(level: NetworkConnection): boolean {
      if (level === NetworkConnection.NONE) {
        return true;
      }

      if (!espState) {
        return false;
      }

      basic.pause(0); // Allow background processing to happen, even if called in a tight loop
      return espState.connection >= level;
    }


    /**
     * Returns true if the specified connection level is reached or exceeded.
     * False otherwise.
     */
    //% subcategory="Network"
    //% blockId="makerbit_network_wait_for_connection"
    //% block="network wait for connection to %state"
    //% weight=91
    export function waitForConnection(level: NetworkConnection): void {
      autoConnectToESP();

      while (!(isConnected(level))) {
        basic.pause(200);
      }
    }

    function setMqttApplicationPrefix() {
      const msg = [
        "mqtt-app ",
        espState.project,
        "/",
        espState.group,
        "\n",
      ].join("");
      serialWriteString(msg);
    }

    function encodeImage(image: Image): number {
      let bits = 0;
      for (let x = 0; x <= 4; x++) {
        for (let y = 0; y <= 4; y++) {
          bits = bits << 1;
          if (image.pixel(x, y)) {
            bits = bits + 1;
          }
        }
      }
      return bits;
    }

    function decodeImage(bits: number): Image {
      let img = images.createImage("");
      for (let x = 4; x >= 0; x--) {
        for (let y = 4; y >= 0; y--) {
          img.setPixel(x, y, (bits & 0x01) == 1);
          bits = bits >> 1;
        }
      }
      return img;
    }
  }
}

