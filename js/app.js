/**
 * Chatlx - Core Application Logic
 * Channels, dynamic registered users, real microphone voice notes, media & emojis.
 */

class ChatlxApp {
  constructor() {
    this.currentRoom = 'general';
    this.rooms = [
      { id: 'general', name: 'عام (General)', desc: 'الدردشة العامة ومناقشة كل المواضيع', unread: 0 },
      { id: 'tech', name: 'تقنية وتطوير', desc: 'برمجة، ذكاء اصطناعي وتكنولوجيا', unread: 0 },
      { id: 'gaming', name: 'ألعاب وميديا', desc: 'نقاشات ألعاب الفيديو والترفيه', unread: 0 },
      { id: 'lounge', name: 'استراحة الشات', desc: 'محادثات جانبية وتعارف الأعضاء', unread: 0 }
    ];

    // Clean channels with no fake people
    this.messages = {
      general: [
        {
          id: 'welcome_1',
          isSystem: true,
          text: 'مرحباً بك في منصة Chatlx! 🎉 يمكنك البدء في كتابة الرسائل، إرسال الفويس، وإرفاق الصور مع المستخدمين المسجلين بحساب Google.',
          time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        }
      ],
      tech: [],
      gaming: [],
      lounge: []
    };

    // Voice recording state
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecordingVoice = false;
    this.recordingDuration = 0;
    this.recordingTimer = null;
    this.recordingStream = null;

    // Attachments & socket
    this.pendingAttachment = null;
    this.socket = null;
    this.audioCtx = null;

    this.init();
  }

  init() {
    this.setupAudioContext();
    this.setupSocket();
    this.setupUIEvents();
    this.setupVoiceRecordingUI();
    this.setupEmojiPicker();
    this.checkSession();
  }

  setupAudioContext() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    } catch (e) {
      console.warn('AudioContext not supported');
    }
  }

  playChime(type = 'receive') {
    if (!this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === 'receive') {
        osc.frequency.setValueAtTime(587.33, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, this.audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.25);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.25);
      } else if (type === 'send') {
        osc.frequency.setValueAtTime(440, this.audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(659.25, this.audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.06, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.18);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.18);
      }
    } catch (e) {
      // Audio playback suppressed or unsupported
    }
  }

  // Socket.io integration
  setupSocket() {
    if (typeof io !== 'undefined') {
      try {
        this.socket = io();
        this.socket.on('connect', () => {
          const user = window.chatlxAuth.getUser();
          if (user) {
            this.socket.emit('user:join', user);
            this.socket.emit('room:join', this.currentRoom);
          }
        });

        // Server sends active users
        this.socket.on('users:update', (users) => {
          this.renderRegisteredUsers(users);
        });

        this.socket.on('users:list', (users) => {
          this.renderRegisteredUsers(users);
        });

        this.socket.on('chat:message', (msg) => {
          this.receiveMessage(msg);
        });

        this.socket.on('chat:typing', (data) => {
          this.showTypingIndicator(data.userName);
        });

        this.socket.on('chat:reaction', ({ msgId, emoji }) => {
          this.applyReaction(msgId, emoji, false);
        });
      } catch (err) {
        console.log('[Chatlx] Local storage reactive mode active.');
      }
    }
  }

  checkSession() {
    const user = window.chatlxAuth.getUser();
    if (user) {
      this.showChatView(user);
    } else {
      this.showLoginView();
    }
  }

  showLoginView() {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('chat-view').classList.add('hidden');
  }

  showChatView(user) {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');

    // Update bottom user card in sidebar
    document.getElementById('current-user-avatar').src = user.avatar;
    document.getElementById('current-user-name').textContent = user.name;
    document.getElementById('current-user-email').innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#60a5fa"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
      ${user.email}
    `;

    this.renderChannels();
    this.renderRegisteredUsers();
    this.switchRoom(this.currentRoom);
    this.showToast(`أهلاً بك يا ${user.name} في Chatlx! 🌟`);

    if (this.socket && this.socket.connected) {
      this.socket.emit('user:join', user);
      this.socket.emit('room:join', this.currentRoom);
    }
  }

  // Render Real Registered Users in Sidebar
  renderRegisteredUsers(serverUsers = null) {
    const container = document.getElementById('registered-users-list');
    if (!container) return;

    container.innerHTML = '';
    const users = serverUsers || window.chatlxAuth.getRegisteredUsers();
    const currentUser = window.chatlxAuth.getUser();

    if (!users || users.length === 0) {
      container.innerHTML = `
        <li style="padding: 10px 14px; font-size: 0.8rem; color: var(--text-dim); text-align: center;">
          لا يوجد مستخدمين مسجلين بعد.
        </li>
      `;
      return;
    }

    users.forEach((user) => {
      const isMe = currentUser && (user.email === currentUser.email);
      const li = document.createElement('li');
      li.className = 'user-item';
      li.innerHTML = `
        <div class="user-avatar-wrap">
          <img class="user-avatar" src="${user.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=' + encodeURIComponent(user.name)}" alt="${user.name}">
          <span class="status-dot ${user.status === 'offline' ? 'offline' : 'online'}"></span>
        </div>
        <div class="user-meta">
          <span class="user-item-name">${user.name} ${isMe ? '<small style="color: var(--accent-secondary);">(أنت)</small>' : ''}</span>
          <span class="user-item-status">${user.email}</span>
        </div>
      `;
      container.appendChild(li);
    });

    const countBadge = document.getElementById('online-users-count');
    if (countBadge) {
      countBadge.textContent = users.length;
    }
  }

  setupUIEvents() {
    // Auth events
    window.addEventListener('chatlx:login', (e) => {
      this.showChatView(e.detail);
    });

    window.addEventListener('chatlx:logout', () => {
      this.showLoginView();
    });

    window.addEventListener('chatlx:users_updated', (e) => {
      this.renderRegisteredUsers(e.detail);
    });

    // Send message handling
    const sendBtn = document.getElementById('send-btn');
    const msgInput = document.getElementById('chat-input');

    const handleSend = () => {
      const text = msgInput.value.trim();
      if (!text && !this.pendingAttachment) return;

      this.sendMessage(text, this.pendingAttachment);
      msgInput.value = '';
      this.clearAttachment();
      msgInput.style.height = 'auto';
    };

    sendBtn.addEventListener('click', handleSend);
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto expand textarea
    msgInput.addEventListener('input', () => {
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
      
      if (this.socket && this.socket.connected) {
        const user = window.chatlxAuth.getUser();
        this.socket.emit('chat:typing', { room: this.currentRoom, userName: user ? user.name : 'مستخدم' });
      }
    });

    // Mobile sidebar toggle
    const menuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('chat-sidebar');
    if (menuBtn && sidebar) {
      menuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
      });
      document.getElementById('chat-main').addEventListener('click', () => {
        sidebar.classList.remove('open');
      });
    }

    // Attachment Input (Image / File)
    const fileInput = document.getElementById('file-upload-input');
    const attachBtn = document.getElementById('attach-btn');
    const removeAttachBtn = document.getElementById('remove-attachment-btn');

    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          this.pendingAttachment = {
            name: file.name,
            size: (file.size / 1024).toFixed(1) + ' KB',
            type: file.type,
            dataUrl: event.target.result
          };
          this.showAttachmentPreview(this.pendingAttachment);
        };
        reader.readAsDataURL(file);
      });
    }

    if (removeAttachBtn) {
      removeAttachBtn.addEventListener('click', () => this.clearAttachment());
    }

    // New Channel Modal
    const addChannelBtn = document.getElementById('add-channel-btn');
    const newChannelModal = document.getElementById('new-channel-modal');
    const closeChannelModal = document.getElementById('close-channel-modal');
    const channelForm = document.getElementById('create-channel-form');

    if (addChannelBtn) {
      addChannelBtn.addEventListener('click', () => newChannelModal.classList.add('active'));
    }
    if (closeChannelModal) {
      closeChannelModal.addEventListener('click', () => newChannelModal.classList.remove('active'));
    }
    if (channelForm) {
      channelForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('channel-name-input').value.trim();
        const desc = document.getElementById('channel-desc-input').value.trim();
        if (name) {
          const id = 'c_' + Date.now();
          this.rooms.push({ id, name, desc: desc || 'قناة دردشة جديدة', unread: 0 });
          this.messages[id] = [];
          this.renderChannels();
          this.switchRoom(id);
          newChannelModal.classList.remove('active');
          channelForm.reset();
          this.showToast(`تم إنشاء قناة #${name} بنجاح!`);
        }
      });
    }
  }

  // ==========================================
  // REAL VOICE NOTE RECORDING (MediaRecorder)
  // ==========================================
  setupVoiceRecordingUI() {
    const recordBtn = document.getElementById('voice-record-btn');
    const recordingBar = document.getElementById('recording-active-bar');
    const cancelBtn = document.getElementById('cancel-recording-btn');
    const sendVoiceBtn = document.getElementById('send-voice-btn');

    if (recordBtn) {
      recordBtn.addEventListener('click', () => {
        this.startVoiceRecording();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.stopVoiceRecording(false);
      });
    }

    if (sendVoiceBtn) {
      sendVoiceBtn.addEventListener('click', () => {
        this.stopVoiceRecording(true);
      });
    }
  }

  async startVoiceRecording() {
    if (this.isRecordingVoice) return;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.showToast('المتصفح لا يدعم تسجيل الصوت المباشر.');
        return;
      }

      this.recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.recordingStream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        if (this.shouldSendVoice) {
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Audio = reader.result;
            const durationSec = Math.max(1, this.recordingDuration);
            this.sendVoiceMessage(base64Audio, durationSec);
          };
          reader.readAsDataURL(audioBlob);
        }
        // Release mic stream
        if (this.recordingStream) {
          this.recordingStream.getTracks().forEach((track) => track.stop());
          this.recordingStream = null;
        }
      };

      this.mediaRecorder.start();
      this.isRecordingVoice = true;
      this.shouldSendVoice = false;
      this.recordingDuration = 0;

      // Show recording UI bar
      const recordingBar = document.getElementById('recording-active-bar');
      const timerEl = document.getElementById('recording-timer');
      if (recordingBar) recordingBar.classList.add('active');

      this.recordingTimer = setInterval(() => {
        this.recordingDuration++;
        const mins = Math.floor(this.recordingDuration / 60);
        const secs = this.recordingDuration % 60;
        if (timerEl) {
          timerEl.textContent = `${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;
        }
      }, 1000);

      this.showToast('بدأ تسجيل الرسالة الصوتية 🎙️');
    } catch (err) {
      console.warn('Microphone permission or access error:', err);
      // Fallback for environments where mic access is blocked
      this.promptSimulatedVoiceRecording();
    }
  }

  stopVoiceRecording(send = true) {
    if (!this.isRecordingVoice) return;

    this.isRecordingVoice = false;
    this.shouldSendVoice = send;
    clearInterval(this.recordingTimer);

    const recordingBar = document.getElementById('recording-active-bar');
    if (recordingBar) recordingBar.classList.remove('active');

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  promptSimulatedVoiceRecording() {
    this.showToast('تم تفعيل تسجيل الفويس التجريبي السريع 🎙️');
    const seconds = 4;
    // Generate synthetic audio tone for demo
    this.sendVoiceMessage(null, seconds);
  }

  sendVoiceMessage(audioDataUrl, duration) {
    const user = window.chatlxAuth.getUser();
    if (!user) return;

    const formattedDuration = `00:${duration < 10 ? '0' + duration : duration}`;
    const newMsg = {
      id: 'voice_' + Date.now(),
      sender: user,
      isVoice: true,
      audioUrl: audioDataUrl,
      voiceDuration: formattedDuration,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      reactions: {}
    };

    this.appendMessage(newMsg, true);
    this.playChime('send');

    if (this.socket && this.socket.connected) {
      this.socket.emit('chat:message', { ...newMsg, room: this.currentRoom });
    }
  }

  // Play audio note
  togglePlayVoice(msgId, audioSrc) {
    const card = document.getElementById(`voice-card-${msgId}`);
    const playBtn = card ? card.querySelector('.voice-play-btn') : null;
    let audio = card ? card.querySelector('audio') : null;

    if (!audio) {
      audio = new Audio(audioSrc);
      card.appendChild(audio);
      audio.onended = () => {
        if (playBtn) playBtn.innerHTML = '▶';
        card.classList.remove('playing');
      };
    }

    if (audio.paused) {
      // Pause any other playing voice notes
      document.querySelectorAll('.voice-note-card.playing').forEach((el) => {
        const otherAudio = el.querySelector('audio');
        if (otherAudio) otherAudio.pause();
        const otherBtn = el.querySelector('.voice-play-btn');
        if (otherBtn) otherBtn.innerHTML = '▶';
        el.classList.remove('playing');
      });

      if (audioSrc) {
        audio.play().catch(() => this.playVoiceBeep());
      } else {
        this.playVoiceBeep();
      }
      if (playBtn) playBtn.innerHTML = '⏸';
      card.classList.add('playing');
    } else {
      audio.pause();
      if (playBtn) playBtn.innerHTML = '▶';
      card.classList.remove('playing');
    }
  }

  playVoiceBeep() {
    if (!this.audioCtx) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.frequency.setValueAtTime(480, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, this.audioCtx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.5);
    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.5);
  }

  showAttachmentPreview(attach) {
    const previewBox = document.getElementById('attachment-preview');
    const thumb = document.getElementById('preview-thumbnail');
    const nameEl = document.getElementById('preview-name');
    const sizeEl = document.getElementById('preview-size');

    thumb.src = attach.dataUrl;
    nameEl.textContent = attach.name;
    sizeEl.textContent = attach.size;
    previewBox.classList.add('active');
  }

  clearAttachment() {
    this.pendingAttachment = null;
    document.getElementById('attachment-preview').classList.remove('active');
    document.getElementById('file-upload-input').value = '';
  }

  setupEmojiPicker() {
    const emojiToggle = document.getElementById('emoji-btn');
    const popover = document.getElementById('emoji-popover');
    const grid = document.getElementById('emoji-grid');
    const msgInput = document.getElementById('chat-input');

    const emojis = [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
      '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
      '😋', '😛', '😜', '🤪', '🤩', '🥳', '😎', '🤓', '🧐', '🤗',
      '🤖', '👾', '🚀', '🔥', '✨', '⚡', '🎉', '🏆', '💯', '❤️',
      '👍', '👏', '🙌', '🤝', '✌️', '💪', '🧠', '💡', '💬', '☕'
    ];

    emojis.forEach((emoji) => {
      const span = document.createElement('span');
      span.className = 'emoji-item';
      span.textContent = emoji;
      span.addEventListener('click', () => {
        msgInput.value += emoji;
        msgInput.focus();
        popover.classList.remove('active');
      });
      grid.appendChild(span);
    });

    emojiToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!popover.contains(e.target) && e.target !== emojiToggle) {
        popover.classList.remove('active');
      }
    });
  }

  renderChannels() {
    const list = document.getElementById('channels-list');
    list.innerHTML = '';

    this.rooms.forEach((room) => {
      const li = document.createElement('li');
      li.className = `channel-item ${room.id === this.currentRoom ? 'active' : ''}`;
      li.innerHTML = `
        <span class="channel-hash">#</span>
        <span class="channel-name">${room.name}</span>
        ${room.unread > 0 ? `<span class="unread-badge">${room.unread}</span>` : ''}
      `;
      li.addEventListener('click', () => this.switchRoom(room.id));
      list.appendChild(li);
    });
  }

  switchRoom(roomId) {
    this.currentRoom = roomId;
    const room = this.rooms.find((r) => r.id === roomId) || this.rooms[0];
    room.unread = 0;

    document.getElementById('current-room-title').textContent = room.name;
    document.getElementById('current-room-desc').textContent = room.desc;

    this.renderChannels();
    this.renderMessages();

    if (this.socket && this.socket.connected) {
      this.socket.emit('room:join', roomId);
    }

    const sidebar = document.getElementById('chat-sidebar');
    if (sidebar) sidebar.classList.remove('open');
  }

  renderMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    const roomMsgs = this.messages[this.currentRoom] || [];
    const currentUser = window.chatlxAuth.getUser();

    // Welcome banner
    const room = this.rooms.find((r) => r.id === this.currentRoom);
    const welcome = document.createElement('div');
    welcome.className = 'room-welcome-card';
    welcome.innerHTML = `
      <h3>مرحباً بك في #${room ? room.name : 'المحادثة'}</h3>
      <p>${room ? room.desc : ''} — بداية سجل الرسائل في Chatlx.</p>
    `;
    container.appendChild(welcome);

    roomMsgs.forEach((msg) => {
      const isSelf = currentUser && (msg.sender && (msg.sender.id === currentUser.id || msg.sender.email === currentUser.email));
      const row = this.createMessageElement(msg, isSelf);
      container.appendChild(row);
    });

    this.scrollToBottom();
  }

  createMessageElement(msg, isSelf) {
    const div = document.createElement('div');

    if (msg.isSystem) {
      div.className = 'system-message-row';
      div.innerHTML = `<div class="system-message-pill">${this.escapeHtml(msg.text)}</div>`;
      return div;
    }

    div.className = `message-row ${isSelf ? 'self' : ''}`;
    div.id = `msg-${msg.id}`;

    let contentHtml = '';

    // Text Content
    if (msg.text) {
      contentHtml += `<div class="msg-bubble">${this.escapeHtml(msg.text)}</div>`;
    }

    // Image Attachment
    if (msg.attachment && msg.attachment.dataUrl) {
      contentHtml += `
        <img class="msg-attachment-img" src="${msg.attachment.dataUrl}" alt="مرفق صورة" onclick="window.open('${msg.attachment.dataUrl}', '_blank')" />
      `;
    }

    // Voice Note Card
    if (msg.isVoice) {
      contentHtml += `
        <div class="msg-bubble">
          <div class="voice-note-card" id="voice-card-${msg.id}">
            <button class="voice-play-btn" type="button" onclick="window.chatlxApp.togglePlayVoice('${msg.id}', '${msg.audioUrl || ''}')">▶</button>
            <div class="voice-waveform">
              <span class="voice-wave-bar" style="animation-delay: 0.1s"></span>
              <span class="voice-wave-bar" style="animation-delay: 0.3s"></span>
              <span class="voice-wave-bar" style="animation-delay: 0.5s"></span>
              <span class="voice-wave-bar" style="animation-delay: 0.2s"></span>
              <span class="voice-wave-bar" style="animation-delay: 0.4s"></span>
            </div>
            <span class="voice-duration">${msg.voiceDuration || '00:05'}</span>
          </div>
        </div>
      `;
    }

    // Reactions HTML
    let reactionsHtml = '';
    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
      reactionsHtml = '<div class="msg-reactions-row">';
      for (const [emoji, count] of Object.entries(msg.reactions)) {
        if (count > 0) {
          reactionsHtml += `<span class="reaction-pill" onclick="window.chatlxApp.applyReaction('${msg.id}', '${emoji}')">${emoji} ${count}</span>`;
        }
      }
      reactionsHtml += '</div>';
    }

    div.innerHTML = `
      <img class="msg-avatar" src="${msg.sender.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=' + encodeURIComponent(msg.sender.name)}" alt="${msg.sender.name}" />
      <div class="msg-content-wrap">
        <div class="msg-header">
          <span class="msg-sender">${msg.sender.name}</span>
          <span class="msg-time">${msg.time}</span>
        </div>
        ${contentHtml}
        ${reactionsHtml}
      </div>
      <div class="msg-actions">
        <button class="msg-action-btn" title="تفاعل" onclick="window.chatlxApp.applyReaction('${msg.id}', '❤️')">❤️</button>
        <button class="msg-action-btn" title="إعجاب" onclick="window.chatlxApp.applyReaction('${msg.id}', '👍')">👍</button>
        <button class="msg-action-btn" title="نار" onclick="window.chatlxApp.applyReaction('${msg.id}', '🔥')">🔥</button>
      </div>
    `;

    return div;
  }

  sendMessage(text, attachment) {
    const user = window.chatlxAuth.getUser();
    if (!user) return;

    const newMsg = {
      id: 'm_' + Date.now(),
      sender: user,
      text: text,
      attachment: attachment ? { ...attachment } : null,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      reactions: {}
    };

    this.appendMessage(newMsg, true);
    this.playChime('send');

    if (this.socket && this.socket.connected) {
      this.socket.emit('chat:message', { ...newMsg, room: this.currentRoom });
    }
  }

  appendMessage(msg, isSelf) {
    if (!this.messages[this.currentRoom]) {
      this.messages[this.currentRoom] = [];
    }
    this.messages[this.currentRoom].push(msg);

    const container = document.getElementById('messages-container');
    const msgElement = this.createMessageElement(msg, isSelf);
    container.appendChild(msgElement);
    this.scrollToBottom();
  }

  receiveMessage(msg) {
    const currentUser = window.chatlxAuth.getUser();
    const isSelf = currentUser && (msg.sender && (msg.sender.id === currentUser.id || msg.sender.email === currentUser.email));

    if (msg.room === this.currentRoom || !msg.room) {
      this.appendMessage(msg, isSelf);
      if (!isSelf) {
        this.playChime('receive');
      }
    } else {
      const targetRoom = this.rooms.find((r) => r.id === msg.room);
      if (targetRoom) {
        targetRoom.unread = (targetRoom.unread || 0) + 1;
        this.renderChannels();
      }
    }
  }

  applyReaction(msgId, emoji, emitSocket = true) {
    const roomMsgs = this.messages[this.currentRoom] || [];
    const msg = roomMsgs.find((m) => m.id === msgId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;

    const oldRow = document.getElementById(`msg-${msgId}`);
    if (oldRow) {
      const currentUser = window.chatlxAuth.getUser();
      const isSelf = currentUser && (msg.sender && (msg.sender.id === currentUser.id || msg.sender.email === currentUser.email));
      const newRow = this.createMessageElement(msg, isSelf);
      oldRow.replaceWith(newRow);
    }

    if (emitSocket && this.socket && this.socket.connected) {
      this.socket.emit('chat:reaction', { msgId, emoji, room: this.currentRoom });
    }
  }

  showTypingIndicator(name) {
    const bar = document.getElementById('typing-bar');
    const textEl = document.getElementById('typing-text');
    textEl.textContent = `${name} يكتب الآن...`;
    bar.style.display = 'flex';
  }

  hideTypingIndicator() {
    const bar = document.getElementById('typing-bar');
    bar.style.display = 'none';
  }

  scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.innerHTML = `<span>💬</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Global initialization
window.addEventListener('DOMContentLoaded', () => {
  window.chatlxApp = new ChatlxApp();
});
