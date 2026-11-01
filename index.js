import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { smsIngestTask } from './src/features/sms/headlessIngest';
import { categoryActionTask } from './src/features/notifications/categoryActionTask';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

// Section 6.1. Run by `SmsIngestService` when a bank message arrives and
// there is no screen open to notice it. The key matches `TASK_KEY` there.
AppRegistry.registerHeadlessTask('SmsIngest', () => smsIngestTask);

// A category button tapped on a "needs a category" notification. Run by
// `CategoryActionService`; the key matches `TASK_KEY` there.
AppRegistry.registerHeadlessTask('CategoryAction', () => categoryActionTask);
