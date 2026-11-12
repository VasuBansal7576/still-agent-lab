import { connect } from 'node:net';

const path = process.argv[2];
if (!path || process.argv.length !== 3) process.exit(2);
const socket = connect(path);
socket.on('error', () => process.exit(1));
socket.on('close', () => process.exit(0));
process.stdin.on('error', () => socket.destroy());
process.stdin.pipe(socket).pipe(process.stdout);
