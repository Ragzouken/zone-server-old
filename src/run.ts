import { host } from './server';
import FileSync = require('lowdb/adapters/FileSync');

host(new FileSync('.data/db.json'));
