const {
SlashCommandBuilder
}=require("discord.js");

const db=require("../database/database");


module.exports={

data:

new SlashCommandBuilder()

.setName("queue")
.setDescription(
"View carry queue"
),



async execute(interaction){


const items =
db.prepare(`

SELECT * FROM queue
WHERE guild=?

`).all(
interaction.guild.id
);



if(!items.length)

return interaction.reply(
"🦆 Queue is empty!"
);



let text="";


items.forEach((x,i)=>{

text+=
`
**#${i+1}**

👤 ${x.roblox}
🏰 ${x.dungeon}
⚔ ${x.difficulty}

`;

});


interaction.reply(text);


}

};