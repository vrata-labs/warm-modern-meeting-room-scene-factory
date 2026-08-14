let modulePromise;

module.exports.handler = async (...args) => {
  modulePromise ??= import("./index.mjs");
  const { handler } = await modulePromise;
  return handler(...args);
};
