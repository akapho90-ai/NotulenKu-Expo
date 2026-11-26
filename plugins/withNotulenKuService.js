const {withAndroidManifest} = require('@expo/config-plugins');

module.exports = config => withAndroidManifest(config, mod => {
  const manifest = mod.modResults.manifest;
  const application = manifest.application[0];
  application.service ||= [];
  const name = 'expo.modules.notulenkurecorder.NotulenKuRecordingService';
  if (!application.service.some(service => service.$['android:name'] === name)) {
    application.service.push({$: {
      'android:name': name,
      'android:exported': 'false',
      'android:foregroundServiceType': 'microphone',
    }});
  }

  manifest['uses-permission'] ||= [];
  for (const permission of ['RECORD_AUDIO', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE', 'POST_NOTIFICATIONS']) {
    const name = 'android.permission.' + permission;
    if (!manifest['uses-permission'].some(entry => entry.$['android:name'] === name)) {
      manifest['uses-permission'].push({$: {'android:name': name}});
    }
  }
  return mod;
});
