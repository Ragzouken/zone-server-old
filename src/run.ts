import { host } from './server';
import FileSync = require('lowdb/adapters/FileSync');

const { server, app } = host(new FileSync('.data/db.json'), {
    listenHandle: process.env.PORT || 8080,
    joinPassword: process.env.JOIN_PASSWORD,
    skipPassword: process.env.SKIP_PASSWORD,
    rebootPassword: process.env.REBOOT_PASSWORD,
});

// trust glitch's proxy to give us socket ips
app.set('trust proxy', true);
// if someone tries to load the page, redirect to the client and tell it this zone's websocket endpoint
app.get('/', (request, response) => {
    response.redirect(`https://kool.tools/zone/?zone=${process.env.PROJECT_DOMAIN}.glitch.me/zone`);
});

server.on('listening', () => console.log('listening...'));
