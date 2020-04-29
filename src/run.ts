import { host } from './server';
import FileSync = require('lowdb/adapters/FileSync');

const server = host(new FileSync('.data/db.json'), {
    listenHandle: process.env.PORT,
    joinPassword: process.env.JOIN_PASSWORD,
    skipPassword: process.env.SKIP_PASSWORD,
    rebootPassword: process.env.REBOOT_PASSWORD,
});

server.on('listening', () => console.log('listening...'));
