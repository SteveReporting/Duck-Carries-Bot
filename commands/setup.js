const {
SlashCommandBuilder
}=require("discord.js");


const db=require("../database/database");


module.exports={


data:

new SlashCommandBuilder()

.setName("setup")

.setDescription(
"Setup Duck Carries"
)

.addChannelOption(option=>

option
.setName("queue")
.setDescription("Queue channel")
.setRequired(true)

)



.addChannelOption(option=>

option
.setName("completed")
.setDescription("Completed channel")
.setRequired(true)

),



async execute(interaction){


const queue=
interaction.options.getChannel("queue");


const completed=
interaction.options.getChannel("completed");



db.prepare(`

INSERT OR REPLACE INTO settings

(guild,queueChannel,completedChannel)

VALUES(?,?,?)

`).run(

interaction.guild.id,
queue.id,
completed.id

);



await interaction.reply({

content:
"🦆 Duck Carries setup complete!",

ephemeral:true

});


}


};