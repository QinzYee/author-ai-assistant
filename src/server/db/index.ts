export { openDatabase } from './connection.js';
export type { DbHandle, DbOptions } from './connection.js';
export { migrate, SCHEMA_VERSION } from './schema.js';
export { createNovelRepository } from './repositories/novels.js';
export type { NovelRepository } from './repositories/novels.js';
