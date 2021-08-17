makerbit.net.connectESP(DigitalPin.P0, DigitalPin.P1);
makerbit.net.connectWiFi("network", "secret");
makerbit.net.connectProjectGroup("123-456-789", "1");
makerbit.net.waitForConnection(NetworkConnection.PROJECT_GROUP);

const isConnected: boolean = makerbit.net.isConnected(
  NetworkConnection.PROJECT_GROUP
);
const level: number = makerbit.net.getConnection();
const error: number = makerbit.net.getLastError();
const device: string = makerbit.net.getDevice();

makerbit.net.sendNumber(1);
makerbit.net.sendString("hello world");
makerbit.net.sendScreenshot();
makerbit.net.sendNumberToChannel(23, "compass");
makerbit.net.sendStringToChannel("Ernie", "name");

makerbit.net.onReceivedNumber((value: number) => { });
makerbit.net.onReceivedString((value: string) => { });
makerbit.net.onReceivedScreenshot((screenshot: Image) => { });
makerbit.net.onReceivedNumberInChannel("compass", (value: number) => { });
makerbit.net.onReceivedStringInChannel("name", (value: string) => { });
makerbit.net.onConnection(() => { });
makerbit.net.onError(() => { });

makerbit.net.setTimeZone(makerbit.timezone(TimeZone.UTC));
makerbit.net.setTimeZoneWithUtcOffset(-8, 0);
const time: string = makerbit.net.getTime();
const date: string = makerbit.net.getDate();
const weekday: number = makerbit.net.getWeekday();