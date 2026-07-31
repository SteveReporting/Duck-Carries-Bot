const db = require("../database/database");


/**
 * Get all active queue requests
 */
function getQueue(guildId){

    return db.prepare(`

        SELECT *
        FROM queue
        WHERE guild=?
        ORDER BY id ASC

    `).all(guildId);

}



/**
 * Get position of a request
 */
function getPosition(guildId, id){

    const queue = getQueue(guildId);

    const position =
        queue.findIndex(
            item => item.id === id
        );

    return position + 1;

}



/**
 * Remove completed/cancelled request
 */
function removeRequest(id){

    db.prepare(`

        DELETE FROM queue
        WHERE id=?

    `).run(id);

}



/**
 * Add a request
 */
function addRequest(data){

    const result =
    db.prepare(`

        INSERT INTO queue

        (
        guild,
        user,
        roblox,
        dungeon,
        difficulty,
        runs,
        availability,
        status
        )

        VALUES
        (?,?,?,?,?,?,?,'waiting')

    `).run(

        data.guild,
        data.user,
        data.roblox,
        data.dungeon,
        data.difficulty,
        data.runs,
        data.availability

    );


    return result.lastInsertRowid;

}



/**
 * Claim request
 */
function claimRequest(id, carrier){

    db.prepare(`

        UPDATE queue

        SET carrier=?,
        status='claimed'

        WHERE id=?

    `).run(

        carrier,
        id

    );

}



/**
 * Complete request
 */
function completeRequest(id){

    const request =
    db.prepare(`

        SELECT *
        FROM queue
        WHERE id=?

    `).get(id);



    if(!request)
        return null;



    db.prepare(`

        DELETE FROM queue
        WHERE id=?

    `).run(id);



    return request;

}



/**
 * Cancel request
 */
function cancelRequest(id){

    db.prepare(`

        DELETE FROM queue
        WHERE id=?

    `).run(id);

}



/**
 * Refresh queue numbers
 * (Used after deleting a request)
 */
function refreshQueue(guildId){

    const queue =
    getQueue(guildId);


    return queue.map(
        (item,index)=>({

            ...item,
            position:index+1

        })
    );

}



module.exports = {

    getQueue,
    getPosition,
    addRequest,
    claimRequest,
    completeRequest,
    cancelRequest,
    refreshQueue

};