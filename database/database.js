const Database=require("better-sqlite3");


const db=new Database(
"./database/duck.db"
);



db.prepare(`

CREATE TABLE IF NOT EXISTS settings(

guild TEXT PRIMARY KEY,
queueChannel TEXT,
requestChannel TEXT,
completedChannel TEXT

)

`).run();



db.prepare(`

CREATE TABLE IF NOT EXISTS queue(

id INTEGER PRIMARY KEY AUTOINCREMENT,
guild TEXT,
user TEXT,
roblox TEXT,
dungeon TEXT,
difficulty TEXT,
runs TEXT,
availability TEXT,
carrier TEXT,
status TEXT DEFAULT 'waiting'

)

`).run();



db.prepare(`

CREATE TABLE IF NOT EXISTS stats(

user TEXT PRIMARY KEY,
completed INTEGER DEFAULT 0

)

`).run();



module.exports=db;