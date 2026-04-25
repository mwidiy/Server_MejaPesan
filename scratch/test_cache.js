const NodeCache = require("node-cache");
const myCache = new NodeCache();

// Simulate GET request saving cache
const storeId = 3;
const originalUrl = "/api/products";
const key1 = `store_${storeId}_${originalUrl}`;
myCache.set(key1, { data: 'some data 1' }, 300);

const originalUrl2 = "/api/products?storeId=3";
const key2 = `store_${storeId}_${originalUrl2}`;
myCache.set(key2, { data: 'some data 2' }, 300);

console.log("Keys before clear:", myCache.keys());

// Simulate clearCache
const prefix = "/api/products";
const keys = myCache.keys();
const keysToDelete = keys.filter(key =>
    key.startsWith(`store_${storeId}_`) && key.includes(prefix)
);

console.log("Keys to delete:", keysToDelete);
if (keysToDelete.length > 0) {
    myCache.del(keysToDelete);
}

console.log("Keys after clear:", myCache.keys());
