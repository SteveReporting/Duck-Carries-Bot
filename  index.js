require("dotenv").config();

const {
Client,
GatewayIntentBits,
Collection
}=require("discord.js");

const fs=require("fs");


const client=new Client({

intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildMessages
]

});


client.commands=new Collection();



fs.readdirSync("./commands")
.filter(file=>file.endsWith(".js"))
.forEach(file=>{

const command=require(`./commands/${file}`);

client.commands.set(
command.data.name,
command
);

});



fs.readdirSync("./events")
.filter(file=>file.endsWith(".js"))
.forEach(file=>{

const event=require(`./events/${file}`);

client.on(
event.name,
(...args)=>event.execute(...args,client)
);

});



client.login(process.env.TOKEN);