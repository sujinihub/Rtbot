import { Markup } from 'telegraf';
import { Admin, BotUser, ApprovedGroup } from '../models/db.js';
import { loginToX, addToQueue, extractXPostId, stopQueue, getQueueStatus, logout, isLoggedIn, resetBrowserSession } from '../helpers/puppeteer.js';

const userStates = {};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getAdminRecord(from) {
  const userId = from?.id != null ? from.id.toString() : null;
  const username = from?.username ? from.username.trim() : null;

  const or = [];
  if (userId) or.push({ userId });
  if (username) or.push({ username: new RegExp(`^${escapeRegExp(username)}$`, 'i') });

  if (or.length === 0) return null;
  return await Admin.findOne({ $or: or });
}

async function syncAdminRecord(from, admin) {
  if (!admin || !from) return;
  const userId = from.id != null ? from.id.toString() : null;
  const username = from.username ? from.username.trim() : null;

  let changed = false;
  if (userId && admin.userId !== userId) {
    admin.userId = userId;
    changed = true;
  }
  if (username && (!admin.username || admin.username.toLowerCase() !== username.toLowerCase())) {
    admin.username = username;
    changed = true;
  }

  if (changed) {
    await admin.save();
  }
}

async function isAdmin(from) {
  return Boolean(await getAdminRecord(from));
}

async function isApprovedGroup(chatId) {
  const group = await ApprovedGroup.findOne({ chatId: chatId.toString(), isApproved: true });
  return !!group;
}

function mainMenuKeyboard() {
  const queueStatus = getQueueStatus();
  const buttons = [
    [Markup.button.callback('⚙️ Bot Settings', 'menu_settings')],
    [Markup.button.callback('🚀 Start Retweet', 'menu_start_retweet')],
  ];
  if (queueStatus.isProcessing || queueStatus.queueLength > 0) {
    buttons.push([Markup.button.callback('⏹️ Stop Retweet', 'menu_stop_retweet')]);
  }
  if (isLoggedIn()) {
    buttons.push([Markup.button.callback('🚪 Logout', 'menu_logout')]);
  }
  buttons.push([Markup.button.callback('👥 Manage Admins', 'menu_admins')]);
  buttons.push([Markup.button.callback('👥 Manage Groups', 'menu_groups')]);
  return Markup.inlineKeyboard(buttons);
}

function backMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('« Back', 'back_menu')]
  ]);
}

async function editOrReply(ctx, text, extra = {}) {
  try {
    if (ctx.callbackQuery && ctx.callbackQuery.message) {
      return await ctx.editMessageText(text, { disable_web_page_preview: true, ...extra });
    }
  } catch (e) { }
  return await ctx.reply(text, { disable_web_page_preview: true, ...extra });
}

export function setupBot(bot) {
  bot.catch((err, ctx) => {
    const isIgnoredGroupNonTextMessage = Boolean(
      ctx?.chat
      && ['group', 'supergroup'].includes(ctx.chat.type)
      && ctx.updateType === 'message'
      && (!ctx.message || !('text' in ctx.message))
    );

    if (isIgnoredGroupNonTextMessage) {
      return;
    }

    console.error('Unhandled error while processing', ctx?.update, err);
  });

  bot.use(async (ctx, next) => {
    if (ctx.updateType === 'my_chat_member') {
      return next();
    }
    
    if (ctx.chat && ctx.chat.type === 'private') {
      if (ctx.from) {
        const admin = await getAdminRecord(ctx.from);
        if (!admin) {
          return;
        }
        await syncAdminRecord(ctx.from, admin);
      } else {
        return;
      }
    } else if (ctx.chat && ['group', 'supergroup'].includes(ctx.chat.type)) {
      if (!(await isApprovedGroup(ctx.chat.id))) {
        return;
      }

      if (ctx.updateType === 'message' && (!ctx.message || !('text' in ctx.message))) {
        return;
      }
    }
    return next();
  });

  bot.on('my_chat_member', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const title = ctx.chat.title;
    const username = ctx.chat.username;
    let group = await ApprovedGroup.findOne({ chatId });
    if (!group) {
      group = new ApprovedGroup({ chatId, title, username });
      await group.save();
    } else {
      group.title = title;
      group.username = username;
      await group.save();
    }
  });

  bot.start(async (ctx) => {
    if (ctx.chat.type === 'private') {
      const admin = await getAdminRecord(ctx.from);
      if (!admin) {
        return;
      }
      await syncAdminRecord(ctx.from, admin);
      await ctx.reply('Welcome to Retweet Bot!', mainMenuKeyboard());
    }
  });

  bot.action('back_menu', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    delete userStates[ctx.from.id];
    await editOrReply(ctx, 'Welcome to Retweet Bot!', mainMenuKeyboard());
  });

  bot.action('menu_settings', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    let user = await BotUser.findOne({ userId: ctx.from.id.toString() });
    if (!user) {
      user = new BotUser({ userId: ctx.from.id.toString(), username: ctx.from.username || null });
      await user.save();
    }
    const emailText = user.xEmail ? `Email/Username: ${user.xEmail}` : 'Email/Username: Not set';
    const passText = user.xPassword ? `Password: ********` : 'Password: Not set';
    await editOrReply(ctx,
      `Current X credentials:\n${emailText}\n${passText}\n${user.xUsername ? `Username: ${user.xUsername}` : ''}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Edit Credentials', 'edit_credentials')],
        [Markup.button.callback('🗑️ Delete Credentials', 'delete_credentials')],
        [Markup.button.callback('« Back', 'back_menu')]
      ])
    );
  });

  bot.action('edit_credentials', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    userStates[ctx.from.id] = { step: 'settings_email' };
    await editOrReply(ctx, 'Send your X (Twitter) email/username:', backMenuKeyboard());
  });

  bot.action('delete_credentials', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    let user = await BotUser.findOne({ userId: ctx.from.id.toString() });
    if (user) {
      user.xEmail = null;
      user.xPassword = null;
      user.xUsername = null;
      user.isLoggedIn = false;
      user.lastLoginAt = null;
      await user.save();
    }
    await resetBrowserSession();
    await editOrReply(ctx, 'Credentials deleted. Browser profile preserved to avoid triggering X anti-bot checks.', mainMenuKeyboard());
  });

  bot.action('menu_start_retweet', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      await ctx.reply('Starting login...');
      const loggedIn = await loginToX(ctx.from.id);
      if (loggedIn) {
        const queueStatus = getQueueStatus();
        if (queueStatus.queueLength === 0) {
          await ctx.reply('Logged in successfully! Waiting for links to retweet...');
        }
      } else {
        await ctx.reply('Login failed. Check credentials and try again.');
      }
    } catch (err) {
      await ctx.reply(`Error: ${err.message}`);
    }
  });

  bot.action('menu_stop_retweet', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    stopQueue();
    await ctx.reply('Retweet queue stopped!', mainMenuKeyboard());
  });

  bot.action('menu_logout', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    try {
      await logout();
      await BotUser.updateOne(
        { userId: ctx.from.id.toString() },
        { isLoggedIn: false, lastLoginAt: null }
      );
      await ctx.reply('Logged out successfully!');
      // Now edit the previous message that had the menu (the one that triggered this callback)
      if (ctx.callbackQuery && ctx.callbackQuery.message) {
        await ctx.editMessageText('Welcome to Retweet Bot!', mainMenuKeyboard()).catch(() => {});
      }
    } catch (err) {
      await ctx.reply(`Error logging out: ${err.message}`);
    }
  });

  bot.action('menu_admins', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await editOrReply(ctx, 'Manage admins:', Markup.inlineKeyboard([
      [Markup.button.callback('➕ Add Admin', 'add_admin')],
      [Markup.button.callback('➖ Remove Admin', 'remove_admin')],
      [Markup.button.callback('📋 List Admins', 'list_admins')],
      [Markup.button.callback('« Back', 'back_menu')]
    ]));
  });

  bot.action('add_admin', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    userStates[ctx.from.id] = { step: 'add_admin' };
    await editOrReply(ctx, 'Send the user ID or @username of the admin to add:', backMenuKeyboard());
  });

  bot.action('remove_admin', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    userStates[ctx.from.id] = { step: 'remove_admin' };
    await editOrReply(ctx, 'Send the user ID or @username of the admin to remove:', backMenuKeyboard());
  });

  bot.action('list_admins', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const admins = await Admin.find();
    const text = admins.length
      ? admins
          .map((a) => {
            const dmStatus = a.userId ? 'DM:✅' : 'DM:❌';
            const idPart = a.userId ? `ID: ${a.userId}` : 'ID: (missing)';
            const usernamePart = a.username ? ` | @${a.username}` : '';
            return `${dmStatus} ${idPart}${usernamePart}`;
          })
          .join('\n')
      : 'No admins found';
    await editOrReply(ctx, text, backMenuKeyboard());
  });

  bot.action('menu_groups', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const groups = await ApprovedGroup.find();
    if (groups.length === 0) {
      userStates[ctx.from.id] = { step: 'approve_group' };
      await editOrReply(ctx, 'No groups found yet. Send the group ID or @username to add/approve a group:', backMenuKeyboard());
      return;
    }
    const keyboard = groups.map(g => [
      Markup.button.callback(`${g.isApproved ? '✅' : '❌'} ${g.title || 'No Title'}${g.username ? ` (@${g.username})` : ''}`, `select_group:${g._id}`)
    ]);
    keyboard.push([Markup.button.callback('➕ Add Group by ID/Username', 'add_group_manual')]);
    keyboard.push([Markup.button.callback('« Back', 'back_menu')]);
    await editOrReply(ctx, 'Select a group to manage:', Markup.inlineKeyboard(keyboard));
  });

  bot.action('add_group_manual', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    userStates[ctx.from.id] = { step: 'approve_group' };
    await editOrReply(ctx, 'Send the group ID or @username to add/approve:', backMenuKeyboard());
  });

  bot.action(/select_group:(.+)/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const groupId = ctx.match[1];
    const group = await ApprovedGroup.findById(groupId);
    if (!group) {
      await editOrReply(ctx, 'Group not found.', backMenuKeyboard());
      return;
    }
    userStates[ctx.from.id] = { step: 'manage_group', groupId: group._id.toString() };
    const statusText = group.isApproved ? 'Approved' : 'Not Approved';
    await editOrReply(ctx,
      `Managing group:\n${group.title || 'No Title'}\nID: ${group.chatId}${group.username ? `\n@${group.username}` : ''}\nStatus: ${statusText}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Approve', 'toggle_approve'), Markup.button.callback('Decline', 'toggle_disapprove')],
        [Markup.button.callback('« Back', 'menu_groups')]
      ])
    );
  });

  bot.action('toggle_approve', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const state = userStates[ctx.from.id];
    if (!state || state.step !== 'manage_group') return;
    const group = await ApprovedGroup.findById(state.groupId);
    if (!group) return;
    group.isApproved = true;
    await group.save();
    const statusText = group.isApproved ? 'Approved' : 'Not Approved';
    await editOrReply(ctx,
      `Managing group:\n${group.title || 'No Title'}\nID: ${group.chatId}${group.username ? `\n@${group.username}` : ''}\nStatus: ${statusText}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Approve', 'toggle_approve'), Markup.button.callback('Decline', 'toggle_disapprove')],
        [Markup.button.callback('« Back', 'menu_groups')]
      ])
    );
  });

  bot.action('toggle_disapprove', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const state = userStates[ctx.from.id];
    if (!state || state.step !== 'manage_group') return;
    const group = await ApprovedGroup.findById(state.groupId);
    if (!group) return;
    group.isApproved = false;
    await group.save();
    const statusText = group.isApproved ? 'Approved' : 'Not Approved';
    await editOrReply(ctx,
      `Managing group:\n${group.title || 'No Title'}\nID: ${group.chatId}${group.username ? `\n@${group.username}` : ''}\nStatus: ${statusText}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Approve', 'toggle_approve'), Markup.button.callback('Decline', 'toggle_disapprove')],
        [Markup.button.callback('« Back', 'menu_groups')]
      ])
    );
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id.toString();
    const state = userStates[userId];

    if (ctx.chat.type === 'private') {
      const admin = await getAdminRecord(ctx.from);
      if (!admin) return;
      await syncAdminRecord(ctx.from, admin);
    }

    if (ctx.chat.type !== 'private') {
      const xPostId = extractXPostId(text);
      if (xPostId) {
        addToQueue({
          url: text,
          telegram: bot.telegram,
          chatId: ctx.chat.id,
          messageId: ctx.message.message_id
        });
        return;
      }

      return;
    }

    if (ctx.chat.type === 'private' && state) {
      if (state.step === 'settings_email') {
        userStates[userId] = { step: 'settings_password', pendingEmail: text };
        await ctx.reply('Now send your X password:', backMenuKeyboard());
        return;
      }

      if (state.step === 'settings_password') {
        let user = await BotUser.findOne({ userId });
        user.xEmail = state.pendingEmail;
        user.xPassword = text;
        user.isLoggedIn = false;
        user.lastLoginAt = null;
        await user.save();
        await resetBrowserSession();
        delete userStates[userId];
        await ctx.reply('Settings saved. Browser profile was preserved to avoid X blocking, but the runtime session was reset.', mainMenuKeyboard());
        return;
      }

      if (state.step === 'add_admin') {
        let admin;
        if (text.startsWith('@')) {
          admin = await Admin.findOne({ username: text.slice(1) });
          if (!admin) {
            admin = new Admin({ username: text.slice(1) });
          }
        } else {
          admin = await Admin.findOne({ userId: text });
          if (!admin) {
            admin = new Admin({ userId: text });
          }
        }
        await admin.save();
        delete userStates[userId];
        await ctx.reply('Admin added!', mainMenuKeyboard());
        return;
      }

      if (state.step === 'remove_admin') {
        if (text.startsWith('@')) {
          await Admin.deleteOne({ username: text.slice(1) });
        } else {
          await Admin.deleteOne({ userId: text });
        }
        delete userStates[userId];
        await ctx.reply('Admin removed!', mainMenuKeyboard());
        return;
      }

      if (state.step === 'approve_group') {
        let group;
        if (text.startsWith('@')) {
          group = await ApprovedGroup.findOne({ username: text.slice(1) });
        } else {
          group = await ApprovedGroup.findOne({ chatId: text });
        }
        if (group) {
          group.isApproved = true;
          await group.save();
        } else {
          group = new ApprovedGroup({
            chatId: text.startsWith('@') ? null : text,
            username: text.startsWith('@') ? text.slice(1) : null,
            isApproved: true
          });
          await group.save();
        }
        delete userStates[userId];
        await ctx.reply('Group approved!', mainMenuKeyboard());
        return;
      }

      if (state.step === 'disapprove_group') {
        if (text.startsWith('@')) {
          await ApprovedGroup.updateOne({ username: text.slice(1) }, { isApproved: false });
        } else {
          await ApprovedGroup.updateOne({ chatId: text }, { isApproved: false });
        }
        delete userStates[userId];
        await ctx.reply('Group disapproved!', mainMenuKeyboard());
        return;
      }
    }
  });
}
