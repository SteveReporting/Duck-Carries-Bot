module.exports={

name:"ready",

execute(client){

console.log(
`${client.user.tag} is online`
);

client.user.setActivity(
"Duck Carries 🦆"
);

}

};