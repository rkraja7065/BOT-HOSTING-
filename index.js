const express = require('express');
const bodyParser = require('body-parser');
const login = require('ws3-fca');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- GLOBAL STATE ---
let botAPI = null;
let adminID = null;
let prefix = '/';
let botNickname = 'BOT 10 KA BISKUT KITNE KA HAI JI';

let lockedGroups = {};
let lockedNicknames = {};
let lockedGroupPhoto = {};
let fightSessions = {};
let joinedGroups = new Set();
let targetSessions = {};
let nickLockEnabled = false;
let nickRemoveEnabled = false;
let gcAutoRemoveEnabled = false;
let currentCookies = null;
let reconnectAttempt = 0;
const signature = `\n                       ─╼≛◉🎲╮👑╭🎲◉≛╾─ ◖◖◙ﾆﾆ◙≛ 𝐑𝐊 𝐑𝐀𝐉𝐀 ≛◙ﾆﾆ◙◗◗`;
const separator = `\n---😈---😈---😈---😈---😈---😈---`;

// --- UTILITY FUNCTIONS ---
function emitLog(message, isError = false) {
  const logMessage = `[${new Date().toISOString()}] ${isError ? '❌ ERROR: ' : '✅ INFO: '}${message}`;
  console.log(logMessage);
  io.emit('botlog', logMessage);
}

function saveCookies() {
  if (!botAPI) {
    emitLog('❌ Cannot save cookies: Bot API not initialized.', true);
    return;
  }
  try {
    const newAppState = botAPI.getAppState();
    const configToSave = {
      botNickname: botNickname,
      cookies: newAppState
    };
    fs.writeFileSync('config.json', JSON.stringify(configToSave, null, 2));
    currentCookies = newAppState;
    emitLog('✅ AppState saved successfully.');
  } catch (e) {
    emitLog('❌ Failed to save AppState: ' + e.message, true);
  }
}

// --- BOT INITIALIZATION AND RECONNECTION LOGIC ---
function initializeBot(cookies, prefix, adminID) {
  emitLog('🚀 Initializing bot with ws3-fca...');
  currentCookies = cookies;
  reconnectAttempt = 0;

  login({ appState: currentCookies }, (err, api) => {
    if (err) {
      emitLog(`❌ Login error: ${err.message}. Retrying in 10 seconds.`, true);
      setTimeout(() => initializeBot(currentCookies, prefix, adminID), 10000);
      return;
    }

    emitLog('✅ Bot successfully logged in.');
    botAPI = api;
    botAPI.setOptions({
      selfListen: true,
      listenEvents: true,
      updatePresence: false
    });

    // Pehle thread list update karein, phir baaki kaam
    updateJoinedGroups(api);

    // Thoda sa delay ke baad baaki functions call karein
    setTimeout(() => {
        setBotNicknamesInGroups();
        sendStartupMessage();
        startListening(api);
    }, 5000); // 5 seconds ka delay

    // Periodically save cookies every 10 minutes
    setInterval(saveCookies, 600000);
  });
}

function startListening(api) {
  api.listenMqtt(async (err, event) => {
    if (err) {
      emitLog(`❌ Listener error: ${err.message}. Attempting to reconnect...`, true);
      reconnectAndListen();
      return;
    }

    try {
      if (event.type === 'message' || event.type === 'message_reply') {
        await handleMessage(api, event);
      } else if (event.logMessageType === 'log:thread-name') {
        await handleThreadNameChange(api, event);
      } else if (event.logMessageType === 'log:user-nickname') {
        await handleNicknameChange(api, event);
      } else if (event.logMessageType === 'log:thread-image') {
        await handleGroupImageChange(api, event);
      } else if (event.logMessageType === 'log:subscribe') {
        await handleBotAddedToGroup(api, event);
      }
    } catch (e) {
      emitLog(`❌ Handler crashed: ${e.message}. Event: ${event.type}`, true);
    }
  });
}

function reconnectAndListen() {
  reconnectAttempt++;
  emitLog(`🔄 Reconnect attempt #${reconnectAttempt}...`, false);

  if (botAPI) {
    try {
      botAPI.stopListening();
    } catch (e) {
      emitLog(`❌ Failed to stop listener: ${e.message}`, true);
    }
  }

  if (reconnectAttempt > 5) {
    emitLog('❌ Maximum reconnect attempts reached. Restarting login process.', true);
    initializeBot(currentCookies, prefix, adminID);
  } else {
    setTimeout(() => {
      if (botAPI) {
        startListening(botAPI);
      } else {
        initializeBot(currentCookies, prefix, adminID);
      }
    }, 5000);
  }
}

async function setBotNicknamesInGroups() {
  if (!botAPI) return;
  try {
    const threads = await botAPI.getThreadList(100, null, ['GROUP']);
    const botID = botAPI.getCurrentUserID();
    for (const thread of threads) {
        try {
            const threadInfo = await botAPI.getThreadInfo(thread.threadID);
            if (threadInfo && threadInfo.nicknames && threadInfo.nicknames[botID] !== botNickname) {
                await botAPI.changeNickname(botNickname, thread.threadID, botID);
                emitLog(`✅ Bot's nickname set in group: ${thread.threadID}`);
            }
        } catch (e) {
            emitLog(`❌ Error setting nickname in group ${thread.threadID}: ${e.message}`, true);
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Thoda sa delay
    }
  } catch (e) {
    emitLog(`❌ Error getting thread list for nickname check: ${e.message}`, true);
  }
}

async function sendStartupMessage() {
  if (!botAPI) return;
  const startupMessage = `😈𝗔𝗟𝗟 𝗛𝗔𝗧𝗘𝗥 𝗞𝗜 𝗠𝗔𝗔 𝗖𝗛𝗢𝗗𝗡𝗘 𝗩𝗔𝗟𝗔 𝐑𝐊 𝐑𝐀𝐉𝐀 𝐊𝐀 𝗕𝗢𝗧 𝗛𝗘𝗥𝗘😈`;
  try {
    const threads = await botAPI.getThreadList(100, null, ['GROUP']);
    for (const thread of threads) {
        botAPI.sendMessage(startupMessage, thread.threadID)
          .catch(e => emitLog(`❌ Error sending startup message to ${thread.threadID}: ${e.message}`, true));
        await new Promise(resolve => setTimeout(resolve, 500)); // Thoda sa delay
    }
  } catch (e) {
    emitLog(`❌ Error getting thread list for startup message: ${e.message}`, true);
  }
}

async function updateJoinedGroups(api) {
  try {
    const threads = await api.getThreadList(100, null, ['GROUP']);
    joinedGroups = new Set(threads.map(t => t.threadID));
    emitGroups();
    emitLog('✅ Joined groups list updated successfully.');
  } catch (e) {
    emitLog('❌ Failed to update joined groups: ' + e.message, true);
  }
}

// --- WEB SERVER & DASHBOARD ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/configure', (req, res) => {
  try {
    const cookies = JSON.parse(req.body.cookies);
    prefix = req.body.prefix || '/';
    adminID = req.body.adminID;

    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).send('Error: Invalid cookies format. Please provide a valid JSON array of cookies.');
    }
    if (!adminID) {
      return res.status(400).send('Error: Admin ID is required.');
    }

    res.send('Bot configured successfully! Starting...');
    initializeBot(cookies, prefix, adminID);
  } catch (e) {
    res.status(400).send('Error: Invalid configuration. Please check your input.');
    emitLog('Configuration error: ' + e.message, true);
  }
});

let loadedConfig = null;
try {
  if (fs.existsSync('config.json')) {
    loadedConfig = JSON.parse(fs.readFileSync('config.json'));
    if (loadedConfig.botNickname) {
      botNickname = loadedConfig.botNickname;
      emitLog('✅ Loaded bot nickname from config.json.');
    }
    if (loadedConfig.cookies && loadedConfig.cookies.length > 0) {
        emitLog('✅ Cookies found in config.json. Initializing bot automatically...');
        initializeBot(loadedConfig.cookies, prefix, adminID);
    } else {
        emitLog('❌ No cookies found in config.json. Please configure the bot using the dashboard.');
    }
  } else {
    emitLog('❌ No config.json found. You will need to configure the bot via the dashboard.');
  }
} catch (e) {
  emitLog('❌ Error loading config file: ' + e.message, true);
}

const PORT = process.env.PORT || 20018;
server.listen(PORT, () => {
  emitLog(`✅ Server running on port ${PORT}`);
});

io.on('connection', (socket) => {
  emitLog('✅ Dashboard client connected');
  socket.emit('botlog', `Bot status: ${botAPI ? 'Started' : 'Not started'}`);
  socket.emit('groupsUpdate', Array.from(joinedGroups));
});

// The rest of the functions remain the same
// ... all your handle* functions go here (handleMessage, handleGroupCommand, etc.)

async function handleBotAddedToGroup(api, event) {
  const { threadID, logMessageData } = event;
  const botID = api.getCurrentUserID();

  if (logMessageData.addedParticipants.some(p => p.userFbId === botID)) {
    try {
      await api.changeNickname(botNickname, threadID, botID);
      await api.sendMessage(`😈HATER KI MAA CHODNE 𝗩𝗔𝗟𝗔 𝗗𝗔𝗥𝗜𝗡𝗗𝗔 𝗕𝗢𝗧 𝗛𝗘𝗥𝗘😈`, threadID);
      emitLog(`✅ Bot added to new group: ${threadID}. Sent welcome message and set nickname.`);
    } catch (e) {
      emitLog('❌ Error handling bot addition: ' + e.message, true);
    }
  }
}

function emitGroups() {
    io.emit('groupsUpdate', Array.from(joinedGroups));
}

// Updated helper function to format all messages
async function formatMessage(api, event, mainMessage) {
    const { senderID } = event;
    let senderName = 'User';
    try {
      const userInfo = await api.getUserInfo(senderID);
      senderName = userInfo && userInfo[senderID] && userInfo[senderID].name ? userInfo[senderID].name : 'User';
    } catch (e) {
      emitLog('❌ Error fetching user info: ' + e.message, true);
    }
    
    // Create the stylish, boxed-like mention text
    const styledMentionBody = `             [🦋°🫧•𖨆٭ ${senderName}꙳○𖨆°🦋]`;
    const fromIndex = styledMentionBody.indexOf(senderName);
    
    // Create the complete mention object
    const mentionObject = {
        tag: senderName,
        id: senderID,
        fromIndex: fromIndex
    };

    const finalMessage = `${styledMentionBody}\n${mainMessage}${signature}${separator}`;

    return {
        body: finalMessage,
        mentions: [mentionObject]
    };
}

async function handleMessage(api, event) {
  try {
    const { threadID, senderID, body, mentions } = event;
    const isAdmin = senderID === adminID;
    
    let replyMessage = '';
    let isReply = false;

    // First, check for mention of the admin
    if (Object.keys(mentions || {}).includes(adminID)) {
      const abuses = [
        "Oye mere boss ko gali dega to teri bah.. chod dunga!",
        "Mai tere baap ko chod du ga bsdike!",
        "Ran..ke mdrxhod teri ma ka b..da!",
        "Teri ma ki ch..tere baap ka nokar nahi hu randi ke!"
      ];
      const randomAbuse = abuses[Math.floor(Math.random() * abuses.length)];
      
      const formattedAbuse = await formatMessage(api, event, randomAbuse);
      return await api.sendMessage(formattedAbuse, threadID);
    }

    // Now, check for commands and trigger words
    if (body) {
      const lowerCaseBody = body.toLowerCase();
      
      if (lowerCaseBody.includes('mkc')) {
        replyMessage = `😈𝐀𝐋𝐎𝐍𝐄 𝐊𝐀 𝐁𝐎𝐓 𝐈𝐃𝐇𝐀𝐑 𝐇𝐈 𝐇𝐀𝐈 𝐁𝐎𝐋 𝐊𝐈𝐒𝐄 𝐏𝐄𝐋𝐔😈`;
        isReply = true;
      } else if (lowerCaseBody.includes('randi')) {
        replyMessage = `😬𝐒𝐔𝐃𝐇𝐀𝐑 𝐉𝐀 𝐁𝐄 𝐁𝐇𝐎𝐒𝐃𝐈𝐊𝐄😬`;
        isReply = true;
      } else if (lowerCaseBody.includes('teri maa chod dunga')) {
        replyMessage = `😜𝗧𝗘𝗥𝗘 𝗦𝗘 𝗖𝗛𝗜𝗡𝗧𝗶  𝗡𝗔𝗛𝗜 𝗖𝗛𝗨𝗗𝗧𝗜 𝗔𝗨𝗥 𝗧𝗨 𝗠𝗔𝗔 𝗖𝗛𝗢𝗗 𝗗𝗘𝗚𝗔😜`;
        isReply = true;
      } else if (lowerCaseBody.includes('chutiya')) {
        replyMessage = `😭𝗧𝗨 𝗖𝗛𝗨𝗧𝗜𝗬𝗔 𝗧𝗘𝗥𝗔 𝗕𝗔𝗔𝗣 𝗖𝗛𝗨𝗧𝗜𝗬𝗔 𝗧𝗘𝗥𝗔 𝗣𝗨𝗥𝗔 𝗞𝗛𝗔𝗡𝗗𝗔𝗡 𝗖𝗛𝗨𝗧𝗜𝗬𝗔 𝗡𝗜𝗞𝗔𝗟 𝗠𝗔𝗗𝗔𝗥𝗫𝗖𝗛𝗢𝗗😭`;
        isReply = true;
      } else if (lowerCaseBody.includes('boxdika')) {
        replyMessage = `🥺𝗟𝗢𝗛𝗘 𝗞𝗔 𝗟𝗨𝗡𝗗 𝗛𝗔𝗜 𝗠𝗘𝗥𝗔 𝗚𝗔𝗥𝗔𝗠 𝗞𝗔𝗥 𝗞𝗘 𝗚𝗔𝗔𝗡𝗗 𝗠𝗔𝗜 𝗗𝗘 𝗗𝗨𝗚𝗔 🥺`;
        isReply = true;
      } else if (lowerCaseBody.trim() === 'bot') {
        const botResponses = [
            `😈𝗕𝗢𝗟 𝗕𝗢𝗫𝗗𝗜𝗞𝗘 𝗞𝗬𝗔 𝗞𝗔𝗔𝗠 𝗛𝗔𝗜😈`,
            `😈𝗔𝗕𝗘 𝗕𝗢𝗧 𝗕𝗢𝗧 𝗡𝗔 𝗞𝗔𝗥 𝗧𝗘𝗥𝗜 𝗚𝗔𝗔𝗡𝗗 𝗠𝗔𝗔𝗥 𝗟𝗨𝗚𝗔 𝗠𝗔𝗜😈`,
            `😜𝗕𝗢𝗟 𝗞𝗜𝗦𝗞𝗜 𝗠𝗔𝗔 𝗖𝗛𝗢𝗗𝗡𝗜 𝗛𝗔𝗜😜`,
            `🙈𝗝𝗔𝗬𝗔𝗗𝗔 𝗕𝗢𝗧 𝗕𝗢𝗧 𝗕𝗢𝗟𝗘𝗚𝗔 𝗧𝗢 𝗧𝗘𝗥𝗜 𝗚𝗔𝗔𝗡𝗗 𝗠𝗔𝗜 𝗣𝗘𝗧𝗥𝗢𝗟 𝗗𝗔𝗔𝗟 𝗞𝗘 𝗝𝗔𝗟𝗔 𝗗𝗨𝗚𝗔😬`,
            `😜𝗧𝗘𝗥𝗜 𝗠𝗞𝗖 𝗗𝗢𝗦𝗧😜`,
            `🙊𝗕𝗢𝗧 𝗕𝗢𝗧 𝗞𝗬𝗔 𝗖𝗛𝗜𝗟𝗔 𝗥𝗔𝗛𝗔 𝗕𝗘 🙊`,
            `😈𝗔𝗕𝗘 𝗕𝗛𝗢𝗦𝗗𝗜𝗞𝗘 𝗞𝗬𝗔 𝗕𝗢𝗧 𝗕𝗢𝗧 𝗞𝗔𝗥 𝗥𝗔 𝗛𝗔𝗜😈`,
            `🥲𝗔𝗕 𝗕𝗔𝗧𝗔 𝗞𝗜𝗦𝗘 𝗣𝗘𝗟𝗨 🥲`
        ];
        replyMessage = botResponses[Math.floor(Math.random() * botResponses.length)];
        isReply = true;
      }
      
      if (isReply) {
          const formattedReply = await formatMessage(api, event, replyMessage);
          return await api.sendMessage(formattedReply, threadID);
      }
    }

    // Now, handle commands
    if (!body || !body.startsWith(prefix)) return;
    const args = body.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Command-specific replies will also be sent with the new format
    let commandReply = '';

    switch (command) {
      case 'group':
        await handleGroupCommand(api, event, args, isAdmin);
        return;
      case 'nickname':
        await handleNicknameCommand(api, event, args, isAdmin);
        return;
      case 'botnick':
        await handleBotNickCommand(api, event, args, isAdmin);
        return;
      case 'tid':
        commandReply = `Group ID: ${threadID}`;
        break;
      case 'uid':
        if (Object.keys(mentions || {}).length > 0) {
          const mentionedID = Object.keys(mentions)[0];
          commandReply = `User ID: ${mentionedID}`;
        } else {
          commandReply = `Your ID: ${senderID}`;
        }
        break;
      case 'fyt':
        await handleFightCommand(api, event, args, isAdmin);
        return;
      case 'stop':
        await handleStopCommand(api, event, isAdmin);
        return;
      case 'target':
        await handleTargetCommand(api, event, args, isAdmin);
        return;
      case 'help':
        await handleHelpCommand(api, event);
        return;
      case 'photolock':
        await handlePhotoLockCommand(api, event, args, isAdmin);
        return;
      case 'gclock':
        await handleGCLock(api, event, args, isAdmin);
        return;
      case 'gcremove':
        await handleGCRemove(api, event, isAdmin);
        return;
      case 'nicklock':
        await handleNickLock(api, event, args, isAdmin);
        return;
      case 'nickremoveall':
        await handleNickRemoveAll(api, event, isAdmin);
        return;
      case 'nickremoveoff':
        await handleNickRemoveOff(api, event, isAdmin);
        return;
      case 'status':
        await handleStatusCommand(api, event, isAdmin);
        return;

      default:
        if (!isAdmin) {
          commandReply = `Teri ma ki ch.. tere baap ka nokar nahi hu randi ke!`;
        } else {
          commandReply = `Ye h mera prefix ${prefix} ko prefix ho use lgake bole ye h mera prefix or devil mera boss h ab bol mdrxhod kya kam h tujhe mujhse bsdike`;
        }
    }
    
    // Send final command reply with the new format
    if (commandReply) {
        const formattedReply = await formatMessage(api, event, commandReply);
        await api.sendMessage(formattedReply, threadID);
    }

  } catch (err) {
    emitLog('❌ Error in handleMessage: ' + err.message, true);
  }
}

async function handleGroupCommand(api, event, args, isAdmin) {
  try {
    const { threadID, senderID } = event;
    if (!isAdmin) {
      const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
      return await api.sendMessage(reply, threadID);
    }
    const subCommand = args.shift();
    if (subCommand === 'on') {
      const groupName = args.join(' ');
      if (!groupName) {
        const reply = await formatMessage(api, event, "Sahi format use karo: /group on <group_name>");
        return await api.sendMessage(reply, threadID);
      }
      lockedGroups[threadID] = groupName;
      await api.setTitle(groupName, threadID);
      const reply = await formatMessage(api, event, `😈𝐆𝐑𝐎𝐔𝐏 𝐍𝐀𝐌𝐄 𝐋𝐎𝐂𝐊 𝐇𝐎 𝐆𝐀𝐘𝐀 𝐇𝐀𝐈 𝐀𝐁 𝐂𝐇𝐀𝐍𝐆𝐄 𝐊𝐀𝐑 𝐊𝐄 𝐃𝐈𝐊𝐇𝐀 𝐓𝐄𝐑𝐈 𝐆𝐀𝐀𝐍𝐃 𝐌𝐀𝐀𝐑 𝐋𝐔𝐆𝐀😈`);
      await api.sendMessage(reply, threadID);
    } else if (subCommand === 'off') {
        delete lockedGroups[threadID];
        const reply = await formatMessage(api, event, "Group name unlock ho gaya hai.");
        await api.sendMessage(reply, threadID);
    }
  } catch (error) {
    emitLog('❌ Error in handleGroupCommand: ' + error.message, true);
    await api.sendMessage("Group name lock karne mein error aa gaya.", threadID);
  }
}

async function handleNicknameCommand(api, event, args, isAdmin) {
  try {
    const { threadID, senderID } = event;
    if (!isAdmin) {
      const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
      return await api.sendMessage(reply, threadID);
    }
    const subCommand = args.shift();
    if (subCommand === 'on') {
      const nickname = args.join(' ');
      if (!nickname) {
        const reply = await formatMessage(api, event, "Sahi format use karo: /nickname on <nickname>");
        return await api.sendMessage(reply, threadID);
      }
      lockedNicknames[threadID] = nickname;
      const threadInfo = await api.getThreadInfo(threadID);
      for (const pid of threadInfo.participantIDs) {
        if (pid !== adminID) {
          await api.changeNickname(nickname, threadID, pid);
        }
      }
      const reply = await formatMessage(api, event, `😈𝐆𝐑𝐎𝐔𝐏 𝐊𝐀 𝐍𝐈𝐂𝐊 𝐍𝐀𝐌𝐄 𝐋𝐎𝐂𝐊 𝐇𝐎 𝐆𝐀𝐘𝐀 𝐇𝐀𝐈 𝐀𝐁 𝐂𝐇𝐀𝐍𝐆𝐄 𝐊𝐀𝐑 𝐊𝐄 𝐃𝐈𝐊𝐇𝐀 𝐇𝐄𝐓𝐄𝐑 𝐓𝐌𝐂 𝐆𝐀𝐀𝐍𝐃 𝐌𝐀𝐀𝐑 𝐋𝐔𝐆𝐀😈`);
      await api.sendMessage(reply, threadID);
    } else if (subCommand === 'off') {
        delete lockedNicknames[threadID];
        const reply = await formatMessage(api, event, "Group ke sabhi nicknames unlock ho gaye hain.");
        await api.sendMessage(reply, threadID);
    }
  } catch (error) {
    emitLog('❌ Error in handleNicknameCommand: ' + error.message, true);
    await api.sendMessage("Nickname lock karne mein error aa gaya.", threadID);
  }
}

async function handleBotNickCommand(api, event, args, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return api.sendMessage(reply, threadID);
  }
  const newNickname = args.join(' ');
  if (!newNickname) {
    const reply = await formatMessage(api, event, "Sahi format use karo: /botnick <nickname>");
    return api.sendMessage(reply, threadID);
  }
  botNickname = newNickname;
  const botID = api.getCurrentUserID();
  try {
    // Save the new nickname to config.json
    fs.writeFileSync('config.json', JSON.stringify({ botNickname: newNickname }, null, 2));
    await api.changeNickname(newNickname, threadID, botID);
    const reply = await formatMessage(api, event, `😈MERA NICKNAME AB ${newNickname} HO GAYA HAI BOSSS.😈`);
    await api.sendMessage(reply, threadID);
  } catch (e) {
    emitLog('❌ Error setting bot nickname: ' + e.message, true);
    const reply = await formatMessage(api, event, '❌ Error: Bot ka nickname nahi badal paya.');
    await api.sendMessage(reply, threadID);
  }
}

async function handleIDCommand(api, event, command) {
  try {
    const { threadID, senderID, mentions } = event;
    if (command === 'tid') {
      const reply = await formatMessage(api, event, `Group ID: ${threadID}`);
      await api.sendMessage(reply, threadID);
    } else if (command === 'uid') {
      if (Object.keys(mentions || {}).length > 0) {
        const mentionedID = Object.keys(mentions)[0];
        const reply = await formatMessage(api, event, `User ID: ${mentionedID}`);
        await api.sendMessage(reply, threadID);
      } else {
        const reply = await formatMessage(api, event, `Your ID: ${senderID}`);
        await api.sendMessage(reply, threadID);
      }
    }
  } catch (error) {
    emitLog('❌ Error in handleIDCommand: ' + error.message, true);
  }
}

async function handleFightCommand(api, event, args, isAdmin) {
  try {
    const { threadID, senderID } = event;
    if (!isAdmin) {
      const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
      return await api.sendMessage(reply, threadID);
    }
    const subCommand = args.shift();
    if (subCommand === 'on') {
      fightSessions[threadID] = {
        active: true
      };
      const reply = await formatMessage(api, event, "Enter hater's name:");
      await api.sendMessage(reply, threadID);
    } else if (subCommand === 'off') {
      if (fightSessions[threadID]) {
        fightSessions[threadID].active = false;
        clearInterval(fightSessions[threadID].interval);
        const reply = await formatMessage(api, event, "Fight mode stopped.");
        await api.sendMessage(reply, threadID);
      }
    } else {
      const reply = await formatMessage(api, event, "Sahi format use karo: /fyt on ya /fyt off");
      await api.sendMessage(reply, threadID);
    }
  } catch (error) {
    emitLog('❌ Error in handleFightCommand: ' + error.message, true);
  }
}

async function handleStopCommand(api, event, isAdmin) {
  try {
    const { threadID, senderID } = event;
    if (!isAdmin) return;

    if (fightSessions[threadID] && fightSessions[threadID].active) {
      fightSessions[threadID].active = false;
      clearInterval(fightSessions[threadID].interval);
      delete fightSessions[threadID];
      const reply = await formatMessage(api, event, "Fight mode stopped.");
      await api.sendMessage(reply, threadID);
    } else if (targetSessions[threadID] && targetSessions[threadID].active) {
      clearInterval(targetSessions[threadID].interval);
      delete targetSessions[threadID];
      const reply = await formatMessage(api, event, "Target off ho gaya.");
      await api.sendMessage(reply, threadID);
    } else {
      const reply = await formatMessage(api, event, "Koi fight ya target mode on nahi hai.");
      await api.sendMessage(reply, threadID);
    }
  } catch (error) {
    emitLog('❌ Error in handleStopCommand: ' + error.message, true);
  }
}

async function handleTargetCommand(api, event, args, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return await api.sendMessage(reply, threadID);
  }

  const subCommand = args.shift()?.toLowerCase();
  
  if (subCommand === 'on') {
    const fileNumber = args.shift();
    const targetName = args.join(' ');

    if (!fileNumber || !targetName) {
      const reply = await formatMessage(api, event, `Sahi format use karo: ${prefix}target on <file_number> <name>`);
      return await api.sendMessage(reply, threadID);
    }

    const filePath = path.join(__dirname, `np${fileNumber}.txt`);
    if (!fs.existsSync(filePath)) {
      const reply = await formatMessage(api, event, `❌ **Error!** File "np${fileNumber}.txt" nahi mila.`);
      return await api.sendMessage(reply, threadID);
    }

    const targetMessages = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(line => line.trim() !== '');

    if (targetMessages.length === 0) {
      const reply = await formatMessage(api, event, `❌ **Error!** File "np${fileNumber}.txt" khali hai.`);
      return await api.sendMessage(reply, threadID);
    }
    
    await api.sendMessage(`😈[ 𝗠𝗘𝗡𝗘 𝗧𝗔𝗥𝗚𝗘𝗧 𝗞𝗢 𝗟𝗢𝗖𝗞 𝗞𝗔𝗥 𝗗𝗜𝗬𝗔 𝗛𝗔𝗜 𝗕𝗢𝗦𝗦 𝗜𝗦𝗞𝗜........ 𝗕𝗘𝗛𝗔𝗡 𝗞𝗢 𝗟𝗨𝗡𝗗 𝗣𝗘 𝗚𝗨𝗡𝗚𝗥𝗨 𝗕𝗔𝗡𝗗 𝗞𝗘 𝗘𝗦𝗘 𝗖𝗛𝗢𝗗𝗨𝗚𝗔 𝗞𝗘 𝗠𝗢𝗛𝗟𝗟𝗘 𝗩𝗔𝗟𝗘 𝗕𝗛𝗜 𝗖𝗢𝗡𝗙𝗨𝗦𝗘 𝗛𝗢 𝗝𝗔𝗬𝗘𝗚𝗘 𝗞𝗘 𝗞𝗜𝗥𝗧𝗔𝗡 𝗛𝗢 𝗥𝗔 𝗛𝗔𝗜 𝗬𝗔 𝗖𝗛𝗨𝗗𝗔𝗜😈]`, threadID);

    if (targetSessions[threadID] && targetSessions[threadID].active) {
      clearInterval(targetSessions[threadID].interval);
      delete targetSessions[threadID];
      const reply = await formatMessage(api, event, "Purana target band karke naya shuru kar raha hu.");
      await api.sendMessage(reply, threadID);
    }

    let currentIndex = 0;
    const interval = setInterval(async () => {
      const message = `${targetName} ${targetMessages[currentIndex]}`;
      try {
        await botAPI.sendMessage(message, threadID);
        currentIndex = (currentIndex + 1) % targetMessages.length;
      } catch (err) {
        emitLog('❌ Target message error: ' + err.message, true);
        clearInterval(interval);
        delete targetSessions[threadID];
        const reply = await formatMessage(api, event, "❌ Target message bhejte waqt error aa gaya. Target band kar diya.");
        await api.sendMessage(reply, threadID);
      }
    }, 10000);

    targetSessions[threadID] = {
      active: true,
      targetName,
      interval
    };
    const reply = await formatMessage(api, event, `💣 **Target lock!** ${targetName} pe 10 second ke delay se messages start ho gaye.`);
    await api.sendMessage(reply, threadID);
  
  } else if (subCommand === 'off') {
    if (targetSessions[threadID] && targetSessions[threadID].active) {
      clearInterval(targetSessions[threadID].interval);
      delete targetSessions[threadID];
      const reply = await formatMessage(api, event, "🛑 **Target Off!** Attack band ho gaya hai.");
      await api.sendMessage(reply, threadID);
    } else {
      const reply = await formatMessage(api, event, "❌ Koi bhi target mode on nahi hai.");
      await api.sendMessage(reply, threadID);
    }
  } else {
    const reply = await formatMessage(api, event, `Sahi format use karo: ${prefix}target on <file_number> <name> ya ${prefix}target off`);
    await api.sendMessage(reply, threadID);
  }
}

async function handleThreadNameChange(api, event) {
  try {
    const { threadID, authorID } = event;
    const newTitle = event.logMessageData?.name;
    if (lockedGroups[threadID] && authorID !== adminID) {
      if (newTitle !== lockedGroups[threadID]) {
        await api.setTitle(lockedGroups[threadID], threadID);
        const userInfo = await api.getUserInfo(authorID);
        const authorName = userInfo[authorID]?.name || "User";
        
        await api.sendMessage({
          body: `🤣𝗚𝗥𝗢𝗨𝗣 𝗞𝗔 𝗡𝗔𝗠𝗘 𝗖𝗛𝗔𝗡𝗚𝗘 𝗞𝗔𝗥𝗘𝗚𝗔 𝗗𝗨𝗕𝗔𝗥𝗔 𝗧𝗢 𝗧𝗘𝗥𝗜 𝗠𝗔𝗔 𝗞𝗜 𝗖𝗛𝗨𝗧𝗧 𝗠𝗔𝗜 𝗣𝗜𝗭𝗔 𝗟𝗔𝗚𝗔 𝗞𝗘 𝗞𝗛𝗔 𝗝𝗔𝗨𝗚𝗔 𝗟𝗔𝗚𝗔 𝗝𝗢𝗥🤣`,
          mentions: [{ tag: authorName, id: authorID, fromIndex: 0 }]
        }, threadID);
      }
    }
  } catch (error) {
    emitLog('❌ Error in handleThreadNameChange: ' + error.message, true);
  }
}

async function handleNicknameChange(api, event) {
  try {
    const { threadID, authorID, participantID, newNickname } = event;
    const botID = api.getCurrentUserID();

    if (participantID === botID && authorID !== adminID) {
      if (newNickname !== botNickname) {
        await api.changeNickname(botNickname, threadID, botID);
        await api.sendMessage(`😈MERA NICKNAME KIO BADLA BSDK, MAINE APNA NAAM WAPAS ${botNickname} RAKH LIYA HAI😈`, threadID);
      }
    }
    
    if (lockedNicknames[threadID] && authorID !== adminID) {
      if (newNickname !== lockedNicknames[threadID]) {
        await api.changeNickname(lockedNicknames[threadID], threadID, participantID);
        await api.sendMessage(`😈GROUP KA NICK NAME CHANGE HO RE HAI AGAR KOI BADLEGA TO USKI PERSONAL ARMY BANUNGA😈`, threadID);
      }
    }
  } catch (error) {
    emitLog('❌ Error in handleNicknameChange: ' + error.message, true);
  }
}

async function handleGroupImageChange(api, event) {
  try {
    const { threadID, authorID } = event;
    if (lockedGroupPhoto[threadID] && authorID !== adminID) {
      const threadInfo = await api.getThreadInfo(threadID);
      if (threadInfo.imageSrc) {
        lockedGroupPhoto[threadID] = threadInfo.imageSrc;
        await api.sendMessage(`Group photo kyu change kiya @${authorID}? Teri ma chod dunga.`, threadID);
      }
    }
  } catch (error) {
    emitLog('❌ Error in handleGroupImageChange: ' + error.message, true);
  }
}

async function handlePhotoLockCommand(api, event, args, isAdmin) {
  try {
    const { threadID, senderID } = event;
    if (!isAdmin) {
      const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
      return await api.sendMessage(reply, threadID);
    }
    const subCommand = args.shift();
    if (subCommand === 'on') {
      const threadInfo = await api.getThreadInfo(threadID);
      if (threadInfo.imageSrc) {
        lockedGroupPhoto[threadID] = threadInfo.imageSrc;
        const reply = await formatMessage(api, event, "Group photo lock ho gaya hai.");
        await api.sendMessage(reply, threadID);
      } else {
        const reply = await formatMessage(api, event, "Group photo lock karne ke liye pehle ek photo set karo.");
        await api.sendMessage(reply, threadID);
      }
    } else if (subCommand === 'off') {
        delete lockedGroupPhoto[threadID];
        const reply = await formatMessage(api, event, "Group photo unlock ho gaya hai.");
        await api.sendMessage(reply, threadID);
    } else {
        const reply = await formatMessage(api, event, "Sahi format use karo: /photolock on ya /photolock off");
        await api.sendMessage(reply, threadID);
    }
  } catch (error) {
    emitLog('❌ Error in handlePhotoLockCommand: ' + error.message, true);
    await api.sendMessage("Photo lock karne mein error aa gaya.", threadID);
  }
}

async function handleHelpCommand(api, event) {
  const { threadID, senderID } = event;
  const helpMessage = `
😈 𝐁𝐎𝐓 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 (RK RAJA 𝐌𝐎𝐃𝐄) 😈
---
📚 **𝐌𝐀𝐃𝐀𝐃**:
  ${prefix}help ➡️ 𝐒𝐀𝐀𝐑𝐄 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒 𝐊𝐈 𝐋𝐈𝐒𝐓 𝐃𝐄𝐊𝐇𝐄𝐈𝐍.

🔐 **𝐆𝐑𝐎𝐔𝐏 𝐒𝐄𝐂𝐔𝐑𝐈𝐓𝐘**:
  ${prefix}group on <name> ➡️ 𝐆𝐑𝐎𝐔𝐏 𝐊𝐀 𝐍𝐀𝐀𝐌 𝐋𝐎𝐂𝐊 𝐊𝐀𝐑𝐄𝐈𝐍.
  ${prefix}group off ➡️ 𝐒𝐓𝐎𝐏 𝐊𝐀𝐑𝐍𝐄 𝐊𝐄 𝐋𝐈𝐘𝐄 /stop 𝐔𝐒𝐄 𝐊𝐀𝐑𝐄𝐈𝐍.
  ${prefix}nickname on <name> ➡️ 𝐒𝐀𝐁𝐇𝐈 𝐍𝐈𝐂𝐊𝐍𝐀𝐌𝐄𝐒 𝐋𝐎𝐂𝐊 𝐊𝐀𝐑𝐄𝐈𝐍.
  ${prefix}nickname off ➡️ 𝐒𝐀𝐁𝐇𝐈 𝐍𝐈𝐂𝐊𝐍𝐀𝐌𝐄𝐒 𝐔𝐍𝐋𝐎𝐊 𝐊𝐀𝐑𝐄𝐈𝐍.
  ${prefix}photolock on ➡️ 𝐆𝐑𝐎𝐔𝐏 𝐏𝐇𝐎𝐓𝐎 𝐋𝐎𝐂𝐊 𝐊𝐀𝐑𝐄𝐈𝐍.
  ${prefix}photolock off ➡️ 𝐆𝐑𝐎𝐔𝐏 𝐏𝐇𝐎𝐓𝐎 𝐔𝐍𝐋𝐎𝐊 𝐊𝐀𝐑𝐄𝐈𝐍.
  ${prefix}botnick <name> ➡️ 𝐁𝐎𝐓 𝐊𝐀 𝐊𝐇𝐔𝐃 𝐊𝐀 𝐍𝐈𝐂𝐊𝐍𝐀𝐌𝐄 𝐒𝐄𝐓 𝐊𝐀𝐑𝐄𝐈𝐍.

💥 **𝐓𝐀𝐑𝐆𝐄𝐓 𝐒𝐘𝐒𝐓𝐄𝐌 (𝐀𝐃𝐌𝐈𝐍 𝐎𝐍𝐋𝐘)**:
  ${prefix}target on <file_number> <name> ➡️ 𝐊𝐈𝐒𝐈 𝐏𝐀𝐑 𝐁𝐇𝐈 𝐀𝐔𝐓𝐎-𝐀𝐓𝐓𝐀𝐂𝐊 𝐒𝐇𝐔𝐑𝐔 𝐊𝐀𝐑𝐄𝐈𝐍.
  ${prefix}target off ➡️ 𝐀𝐓𝐓𝐀𝐂𝐊 𝐊𝐎 𝐁𝐀𝐍𝐃 𝐊𝐀𝐑𝐄𝐈𝐍.

⚔️ **𝐅𝐈𝐆𝐇𝐓 𝐌𝐎𝐃𝐄 (𝐀𝐃𝐌𝐈𝐍 𝐎𝐍𝐋𝐘)**:
  ${prefix}fyt on ➡️ 𝐅𝐈𝐆𝐇𝐓 𝐌𝐎𝐃𝐄 𝐒𝐇𝐔𝐑𝐔 𝐊𝐀𝐑𝐄𝐈𝐍 𝐀𝐋𝐎𝐍𝐄 𝐁𝐎𝐒𝐒.
  ${prefix}stop ➡️ 𝐅𝐈𝐆𝐇𝐓 𝐌𝐎𝐃𝐄 𝐁𝐀𝐍𝐃 𝐊𝐀𝐑 𝐃𝐈𝐘𝐀 𝐁𝐇𝐎𝐒𝐃𝐈 𝐕𝐀𝐋𝐄 𝐍𝐄 𝐀𝐋𝐎𝐍𝐄 𝐁𝐎𝐒𝐒.

🆔 **𝐈𝐃 𝐃𝐄𝐓𝐀𝐈𝐋𝐒**:
  ${prefix}tid ➡️ 𝐆𝐑𝐎𝐔𝐏 𝐈𝐃 𝐏𝐀𝐓𝐀 𝐊𝐀𝐑𝐄𝐈𝐍.
  ${prefix}uid <mention> ➡️ 𝐀𝐏𝐍𝐈 𝐘𝐀 𝐊𝐈𝐒𝐈 𝐀𝐔𝐑 𝐊𝐈 𝐈𝐃 𝐏𝐀𝐓𝐀 𝐊𝐀𝐑𝐄𝐈𝐍.
`;
  const formattedHelp = await formatMessage(api, event, helpMessage.trim());
  await api.sendMessage(formattedHelp, threadID);
}

// All other command handlers are included and unchanged
async function handleGCLock(api, event, args, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return api.sendMessage(reply, threadID);
  }

  const newName = args.join(' ').trim();
  if (!newName) {
    const reply = await formatMessage(api, event, "❌ Please provide a group name");
    return api.sendMessage(reply, threadID);
  }

  lockedGroups[threadID] = newName;
  gcAutoRemoveEnabled = false;

  await api.setTitle(newName, threadID);
  const reply = await formatMessage(api, event, `🔒 Group name locked: "${newName}"`);
  api.sendMessage(reply, threadID);
}

async function handleGCRemove(api, event, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return api.sendMessage(reply, threadID);
  }

  lockedGroups[threadID] = null;
  gcAutoRemoveEnabled = true;

  await api.setTitle("", threadID);
  const reply = await formatMessage(api, event, "🧹 Name removed. Auto-remove ON ✅");
  api.sendMessage(reply, threadID);
}

async function handleNickLock(api, event, args, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return api.sendMessage(reply, threadID);
  }

  const newNick = args.join(' ').trim();
  if (!newNick) {
    const reply = await formatMessage(api, event, "❌ Please provide a nickname");
    return api.sendMessage(reply, threadID);
  }

  nickLockEnabled = true;
  lockedNicknames[threadID] = newNick;

  const threadInfo = await api.getThreadInfo(threadID);
  for (const user of threadInfo.userInfo) {
    await api.changeNickname(newNick, threadID, String(user.id));
  }
  const reply = await formatMessage(api, event, `🔐 Nickname locked: "${newNick}"`);
  api.sendMessage(reply, threadID);
}

async function handleNickRemoveAll(api, event, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return api.sendMessage(reply, threadID);
  }

  nickRemoveEnabled = true;
  nickLockEnabled = false;
  lockedNicknames[threadID] = null;

  const threadInfo = await api.getThreadInfo(threadID);
  for (const user of threadInfo.userInfo) {
    await api.changeNickname("", threadID, String(user.id));
  }
  const reply = await formatMessage(api, event, "💥 Nicknames cleared. Auto-remove ON");
  api.sendMessage(reply, threadID);
}

async function handleNickRemoveOff(api, event, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return api.sendMessage(reply, threadID);
  }

  nickRemoveEnabled = false;
  const reply = await formatMessage(api, event, "🛑 Nick auto-remove OFF");
  api.sendMessage(reply, threadID);
}

async function handleStatusCommand(api, event, isAdmin) {
  const { threadID, senderID } = event;
  if (!isAdmin) {
    const reply = await formatMessage(api, event, "Permission denied, you are not the admin.");
    return api.sendMessage(reply, threadID);
  }

  const msg = `
BOT STATUS:
• GC Lock: ${lockedGroups[threadID] || "OFF"}
• GC AutoRemove: ${gcAutoRemoveEnabled ? "ON" : "OFF"}
• Nick Lock: ${nickLockEnabled ? `ON (${lockedNicknames[threadID]})` : "OFF"}
• Nick AutoRemove: ${nickRemoveEnabled ? "ON" : "OFF"}
`;
  const reply = await formatMessage(api, event, msg.trim());
  api.sendMessage(reply, threadID);
}
