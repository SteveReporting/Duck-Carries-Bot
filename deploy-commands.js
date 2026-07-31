require("dotenv").config();


const fs=require("fs");

const {
REST,
Routes
}=require("discord.js");


const commands=[];


fs.readdirSync("./commands")

.filter(f=>f.endsWith(".js"))

.forEach(file=>{

const command=require(
`./commands/${file}`
);

commands.push(
command.data.toJSON()
);

});



const rest=new REST({

version:"10"

}).setToken(
process.env.TOKEN
);



rest.put(

Routes.applicationGuildCommands(

process.env.CLIENT_ID,

process.env.GUILD_ID

),

{
body:commands
}

)

.then(()=>console.log(
"Commands deployed"
))

.catch(console.error);