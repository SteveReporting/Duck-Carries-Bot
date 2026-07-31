const db = require("../database/database");
const {
ModalBuilder,
TextInputBuilder,
TextInputStyle,
ActionRowBuilder,
EmbedBuilder,
ButtonBuilder,
ButtonStyle
} = require("discord.js");


module.exports={

name:"interactionCreate",

async execute(interaction,client){


/* SLASH COMMANDS */

if(interaction.isChatInputCommand()){

const command =
client.commands.get(interaction.commandName);

if(command)
return command.execute(interaction);

}



/* BUTTONS */

if(interaction.isButton()){


if(interaction.customId==="create_carry"){


const modal = new ModalBuilder()
.setCustomId("carry_modal")
.setTitle("Request Carry");


const fields=[

["roblox","Roblox Username"],
["dungeon","Dungeon"],
["difficulty","Difficulty"],
["runs","Number of Runs"],
["availability","Availability"]

];


let rows=[];


fields.forEach(f=>{

const input =
new TextInputBuilder()

.setCustomId(f[0])
.setLabel(f[1])
.setStyle(TextInputStyle.Short)
.setRequired(true);


rows.push(
new ActionRowBuilder()
.addComponents(input)
);

});


modal.addComponents(rows);


return interaction.showModal(modal);


}



if(interaction.customId.startsWith("claim_")){


const id =
interaction.customId.split("_")[1];


const member =
interaction.member;


if(!member.roles.cache.has(process.env.CARRIER_ROLE))

return interaction.reply({

content:"❌ You are not a carrier",

ephemeral:true

});


db.prepare(`

UPDATE queue

SET carrier=?,status='claimed'

WHERE id=?

`).run(

member.id,
id

);



await interaction.update({

content:
`🟢 Claimed by ${member}`,

components:[]

});


}



if(interaction.customId.startsWith("complete_")){


const id =
interaction.customId.split("_")[1];


const item =
db.prepare(
"SELECT * FROM queue WHERE id=?"
).get(id);



db.prepare(
"DELETE FROM queue WHERE id=?"
).run(id);



db.prepare(`

INSERT INTO stats(user,completed)

VALUES(?,1)

ON CONFLICT(user)

DO UPDATE SET completed=completed+1

`).run(item.carrier);



interaction.reply({

content:"✅ Carry completed",

ephemeral:true

});


}

}



/* MODAL */

if(interaction.isModalSubmit()){


if(interaction.customId==="carry_modal"){


const get=id=>
interaction.fields.getTextInputValue(id);



const result =
db.prepare(`

INSERT INTO queue

(guild,user,roblox,dungeon,difficulty,runs,availability,status)

VALUES(?,?,?,?,?,?,?,'waiting')

`).run(

interaction.guild.id,
interaction.user.id,
get("roblox"),
get("dungeon"),
get("difficulty"),
get("runs"),
get("availability")

);



const settings =
db.prepare(

"SELECT * FROM settings WHERE guild=?"

).get(
interaction.guild.id
);



const channel =
interaction.guild.channels.cache.get(
settings.queueChannel
);



const embed =
new EmbedBuilder()

.setTitle(
`🦆 Carry Request #${result.lastInsertRowid}`
)

.setDescription(`

👤 Roblox Username:
${get("roblox")}

🏰 Dungeon:
${get("dungeon")}

⚔ Difficulty:
${get("difficulty")}

👥 Runs:
${get("runs")}

🕒 Availability:
${get("availability")}

Status:
🟡 Waiting

`)

.setTimestamp();



const claim =
new ButtonBuilder()

.setCustomId(
`claim_${result.lastInsertRowid}`
)

.setLabel("✅ Claim")
.setStyle(ButtonStyle.Success);



const row =
new ActionRowBuilder()
.addComponents(claim);



channel.send({

content:
`<@&${process.env.CARRIER_ROLE}>`,

embeds:[embed],

components:[row]

});


interaction.reply({

content:
"✅ Your carry request has been added to queue!",

ephemeral:true

});


}

}


}

};