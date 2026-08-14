const {
SlashCommandBuilder,
ButtonBuilder,
ButtonStyle,
ActionRowBuilder
}=require("discord.js");


module.exports={

data:

new SlashCommandBuilder()

.setName("panel")
.setDescription(
"Create The Carry Tavern request panel"
),


async execute(interaction){


const button =
new ButtonBuilder()

.setCustomId(
"create_carry"
)

.setLabel(
"🍺 Request a Carry"
)

.setStyle(
ButtonStyle.Primary
);



await interaction.reply({

content:
`
# 🍺 The Carry Tavern

Need a carry? Pull up a stool and send in your request below.

Please only request carries when you are available.
`,

components:[

new ActionRowBuilder()
.addComponents(button)

]

});


}

};