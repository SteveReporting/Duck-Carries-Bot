const {
SlashCommandBuilder
}=require("discord.js");


const db=require("../database/database");


module.exports={


data:

new SlashCommandBuilder()

.setName("leaderboard")

.setDescription(
"Carrier leaderboard"
),


async execute(interaction){


const rows =
db.prepare(`

SELECT * FROM stats

ORDER BY completed DESC

LIMIT 10

`).all();



let msg="🏆 **Duck Carrier Leaderboard**\n\n";


rows.forEach((r,i)=>{

msg+=
`${i+1}. <@${r.user}> - ${r.completed} carries\n`;

});


interaction.reply(msg);


}

};