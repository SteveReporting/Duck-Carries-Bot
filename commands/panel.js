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
"Create carry request panel"
),


async execute(interaction){


const button =
new ButtonBuilder()

.setCustomId(
"create_carry"
)

.setLabel(
"➕ Create Carry Request"
)

.setStyle(
ButtonStyle.Primary
);



await interaction.reply({

content:
`
# 🦆 Request a Carry

Click the button below and fill out the form.

Please only request carries when you are available.
`,

components:[

new ActionRowBuilder()
.addComponents(button)

]

});


}

};