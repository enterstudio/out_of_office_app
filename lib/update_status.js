var requests = {

    getSingleAgent: function(user_id) {
        return {
            url: helpers.fmt('/api/v2/users/%@.json', user_id)
        };
    },

    setAgentStatus: function(user_id, away_status) {
        var data = {user: {user_fields:{}}};                                //generate an object (using this method to allow a dynamic user field key)
        data.user.user_fields[this.options.userFieldKey] = away_status;     //assign the current status and push to server
        data = JSON.stringify(data);
        return {
            url: helpers.fmt('/api/v2/users/%@.json', user_id),
            dataType: 'JSON',
            type: 'PUT',
            contentType: 'application/json',
            data: data
        };
    },

    bulkTagTicket: function(paramaters) {
        var data = {
            "ticket": {
            }
        };
        data.ticket[paramaters.paramaters] = [this.options.userFieldKey];
        return {
            type: 'PUT',
            contentType: 'application/json',
            url: helpers.fmt('/api/v2/tickets/update_many.json?ids=%@', paramaters.idList.join(',')),
            data: JSON.stringify(data)
        };
    },

    pendingTickets: function(user_id, page) { //this generates a view preview for pending tickets assigned to a user
        user_id = encodeURIComponent(user_id); //TODO: generalize this and merge w/ ticketPreview to add some more flexibility
        return {                               //possibly pass in a conditions object?
            url: helpers.fmt('/api/v2/views/preview.json?page=%@', page),
            dataType: 'JSON',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                "view": {
                    "title": 'out-of-office app [System View]',
                    "active": true,
                    "conditions" : {
                        "all": [{
                            "field": "status",
                            "operator": "greater_than",
                            "value": "open"
                        },
                        {
                            "field": "status",
                            "operator": "less_than",
                            "value": "closed"
                        },
                        {
                            "field": "assignee_id",
                            "operator": "is",
                            "value": user_id
                        }]
                    }
                }
            })
        };
    },

    ticketPreview: function(user_id, page) {
        user_id = encodeURIComponent(user_id);
        return {
            url: helpers.fmt('/api/v2/views/preview.json?page=%@', page), //paginated so that we can go through all entries
            dataType: 'JSON',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                "view": {
                    "title": 'out-of-office app [System View]',
                    "active": true,
                    "conditions" : {
                        "all": [
                        {
                            "field": "status",
                            "operator": "less_than",
                            "value": "closed"
                        },
                        {
                            "field": "assignee_id",
                            "operator": "is",
                            "value": user_id
                        }]
                    }
                }
            })
        };
    },

    setAvailableTickePreview: function(user_id, page) {
        user_id = encodeURIComponent(user_id);
        return {
            url: helpers.fmt('/api/v2/views/preview.json?page=%@', page), //paginated so that we can go through all entries
            dataType: 'JSON',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                "view": {
                    "title": 'out-of-office app [System View]',
                    "active": true,
                    "conditions" : {
                        "all": [
                        {
                            "field": "status",
                            "operator": "less_than",
                            "value": "closed"
                        },
                        {
                            "field": "assignee_id",
                            "operator": "is",
                            "value": user_id
                        },
                        {
                            "field": "current_tags",
                            "operator": "includes",
                            "value": this.options.userFieldKey
                        }]
                    }
                }
            })
        };
    },

};

//container for private (local) objects and methods
var util = {

    applyTag: function(agent, ticketView) {
        var isOut = agent.user_fields[util.settings.userFieldKey];
        agent.user_fields[util.settings.userFieldKey] = !isOut;
        var count = 0;
        var total = 0;

        return util.appFramework.promise(function(done, fail) {
            util.appFramework.updating[agent.id] = {tagging: true, percentage: 0, user:agent};
            util.appFramework.trigger('start_tagging', {agent: agent, count: count});
            util.appFramework.trigger('tag_progress', {agent: agent, total: total, count: count});

            util.getView('rows', [ticketView, agent.id], function(page, data, request) {
                if(total === 0) {
                    total = Math.ceil(page.count / 100) * 2;
                }
                count = count + 1;
                util.appFramework.updating[agent.id] = {tagging: true, percentage: (count/total) * 100, user:agent};
                util.appFramework.trigger('tag_progress', {agent: agent, total: total, count: count});
            }).done(function(tickets){
                if(tickets[0] === undefined) {
                    util.appFramework.updating[agent.id] = {tagging: false, percentage: 0, user:agent};
                    util.appFramework.trigger('tickets_tagged', {count: 1, name: agent.name, ticketView: ticketView});
                    done();
                } else {
                    var operator = (isOut) ? 'additional_tags'                     //depending on agent status, either tag or untag ticket
                                          : 'remove_tags',
                        ticketIDs = [].map.call(tickets, function(ticket) {
                            return ticket.ticket.id;                    //create an array of ticket IDs
                        });
                    util.bulkUpdate('bulkTagTicket', ticketIDs, operator, 10, function(complete) {
                        count = count + 1;
                        util.appFramework.updating[agent.id] = {tagging: true, percentage: (count/total) * 100, user:agent};
                        util.appFramework.trigger('tag_progress', {agent: agent, total: total, count: count});
                    }).done(function() {  //run the request on the entire batch of tickets
                        util.appFramework.updating[agent.id] = {tagging: false, percentage: 0};
                        util.appFramework.trigger('tickets_tagged', {count: count, name: agent.name, ticketView: ticketView});
                        done();
                    }).fail(function(error) {
                        util.appFramework.trigger('functional_error', {location: 'applyTag', agent: agent, errorCode: error.status});
                        fail();
                    });
                }
            }).fail(function() {
                util.appFramework.trigger('functional_error', {location: 'applyTag', agent: agent});
                fail();
            });
        });
    },

    setStatus: function(agent, unassignTickets) { //toggles status (will set status to reverse of what agent is passed)
        return util.appFramework.promise(function(done,fail) {
            util.appFramework.ajax('setAgentStatus', agent.id, !agent.user_fields[util.settings.userFieldKey]).done(function(agent) {
                agent = agent.user;
                var status = 'here';
                if(agent.user_fields[util.settings.userFieldKey]) {
                    status = 'away';
                }
                if(unassignTickets) {
                    util.applyTag(agent, 'ticketPreview')
                    .done(agent); //if unassignTickets or if agent is coming back availaible, tag all tickets instead of just pending
                } else if(!agent.user_fields[util.settings.userFieldKey]) {
                    util.applyTag(agent, 'setAvailableTickePreview')
                    .done(agent);
                } else {
                    util.applyTag(agent, 'pendingTickets')
                    .done(agent); //otherwise, only tag pending tickets
                }
                util.appFramework.trigger('status_changed', {agent: agent});
            }).fail(function(error) {
                util.appFramework.trigger('functional_error', {location: 'setStatus', agent: agent, status: !agent.user_fields[util.settings.userFieldKey], errorCode: error.status});
                util.appFramework.trigger('network_error', {request: 'setAgentStatus', requestType: 'ajax', agent: agent, error: error});
                fail();
            });
        });
    }
};

module.exports = {

    factory: function(context, settings) {
        _.extend(context.requests, requests); //add in needed requests for the module
        _.extend(util, context.require('get_all')); //add in getAll methods to util
        util.appFramework = context;
        util.settings = settings;
        return {
            toggleStatus: this.toggleStatus,
        };
    },

    toggleStatus: function(user_id, unassignTickets) {
        return util.appFramework.promise(function(done, fail) {
            util.appFramework.ajax('getSingleAgent', user_id).done(function(agent) { //get agent
                agent = agent.user;
                util.setStatus(agent, unassignTickets).done(function(agent) {
                    done();
                });
            });
        });
    },
};
