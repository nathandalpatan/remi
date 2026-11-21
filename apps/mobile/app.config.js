const isBeta = process.env.APP_VARIANT === 'beta';

module.exports = ({ config }) => ({
  ...config,
  name: isBeta ? 'Remi Beta' : config.name,
  android: {
    ...config.android,
    package: isBeta ? 'com.remi.receipts.beta' : config.android.package,
  },
});
