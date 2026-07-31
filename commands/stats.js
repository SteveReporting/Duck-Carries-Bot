const {
SlashCommandBuilder
}=require("discord.js");

const db=require("../database/database");


module.exports={

data:

new SlashCommandBuilder()

.setName("stats")
.setDescription(
"View carrier stats"
)

.addUserOption(o=>

o.setName("user")
.setDescription("User")

),


async execute(interaction){


const user =
interaction.options.getUser("user")
||interaction.user;



const data =
db.prepare(

"SELECT * FROM stats WHERE user=?"

).get(user.id);



interaction.reply(

`${user.username} has completed ${
data?.completed||0
} carries`

);


}

};