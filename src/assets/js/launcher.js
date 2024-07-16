// import panel
import Login from './panels/login.js';
import Home from './panels/home.js';
import Settings from './panels/settings.js';

// import modules
import { logger, config, changePanel, database, popup, setBackground, accountSelect, addAccount, pkg, appdata } from './utils.js';
const { AZauth, Microsoft, Mojang } = require('minecraft-java-core');

// libs
const { ipcRenderer } = require('electron');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

class Launcher {
    async init() {
        this.initLog();
        console.log('Initializing Launcher...');
        this.shortcut();
        await setBackground();
        if (process.platform == 'win32') this.initFrame();
        this.config = await config.GetConfig().then(res => res).catch(err => err);
        if (await this.config.error) return this.errorConnect();
        this.db = new database();
        await this.initConfigClient();
        this.createPanels(Login, Home, Settings);
        await this.sendModsMD5();  // Envoyer les MD5 des mods avant de lancer le jeu
        await this.startLauncher();  // Attend que le lanceur soit prêt
    }

    initLog() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
                ipcRenderer.send('main-window-dev-tools-close');
                ipcRenderer.send('main-window-dev-tools');
            }
        })
        new logger(pkg.name, '#7289da')
    }

    shortcut() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.keyCode == 87) {
                ipcRenderer.send('main-window-close');
            }
        })
    }

    errorConnect() {
        new popup().openPopup({
            title: this.config.error.code,
            content: this.config.error.message,
            color: 'red',
            exit: true,
            options: true
        });
    }

    initFrame() {
        console.log('Initializing Frame...')
        document.querySelector('.frame').classList.toggle('hide')
        document.querySelector('.dragbar').classList.toggle('hide')

        document.querySelector('#minimize').addEventListener('click', () => {
            ipcRenderer.send('main-window-minimize');
        });

        let maximized = false;
        let maximize = document.querySelector('#maximize')
        maximize.addEventListener('click', () => {
            if (maximized) ipcRenderer.send('main-window-maximize')
            else ipcRenderer.send('main-window-maximize');
            maximized = !maximized
            maximize.classList.toggle('icon-maximize')
            maximize.classList.toggle('icon-restore-down')
        });

        document.querySelector('#close').addEventListener('click', () => {
            ipcRenderer.send('main-window-close');
        })
    }

    async initConfigClient() {
        console.log('Initializing Config Client...')
        let configClient = await this.db.readData('configClient')

        if (!configClient) {
            await this.db.createData('configClient', {
                account_selected: null,
                instance_selct: null,
                java_config: {
                    java_path: null,
                    java_memory: {
                        min: 2,
                        max: 4
                    }
                },
                game_config: {
                    screen_size: {
                        width: 854,
                        height: 480
                    }
                },
                launcher_config: {
                    download_multi: 5,
                    theme: 'auto',
                    closeLauncher: 'close-launcher',
                    intelEnabledMac: true
                }
            })
        }
    }

    createPanels(...panels) {
        let panelsElem = document.querySelector('.panels')
        for (let panel of panels) {
            console.log(`Initializing ${panel.name} Panel...`);
            let div = document.createElement('div');
            div.classList.add('panel', panel.id)
            div.innerHTML = fs.readFileSync(`${__dirname}/panels/${panel.id}.html`, 'utf8');
            panelsElem.appendChild(div);
            new panel().init(this.config);
        }
    }

    async startLauncher() {
        let accounts = await this.db.readAllData('accounts');
        let configClient = await this.db.readData('configClient');
        let account_selected = configClient ? configClient.account_selected : null;
        let popupRefresh = new popup();

        if (accounts?.length) {
            for (let account of accounts) {
                let account_ID = account.ID;
                if (account.error) {
                    await this.db.deleteData('accounts', account_ID);
                    continue;
                }
                console.log("Account " + account.meta);
                if (account.meta.type === 'Xbox') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Connexion',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });

                    let refresh_accounts = await new Microsoft(this.config.client_id).refresh(account);

                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            await this.db.updateData('configClient', configClient);
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID;
                    await this.db.updateData('accounts', refresh_accounts, account_ID);
                    await addAccount(refresh_accounts);
                    if (account_ID == account_selected) accountSelect(refresh_accounts);
                } else if (account.meta.type == 'AZauth') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Connexion',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    let refresh_accounts = await new AZauth(this.config.online).verify(account);

                    if (refresh_accounts.error) {
                        this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            this.db.updateData('configClient', configClient);
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.message}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID;
                    this.db.updateData('accounts', refresh_accounts, account_ID);
                    await addAccount(refresh_accounts);
                    if (account_ID == account_selected) accountSelect(refresh_accounts);
                } else if (account.meta.type == 'Mojang') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Connexion',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    if (account.meta.online == false) {
                        let refresh_accounts = await Mojang.login(account.name);

                        refresh_accounts.ID = account_ID;
                        await addAccount(refresh_accounts);
                        this.db.updateData('accounts', refresh_accounts, account_ID);
                        if (account_ID == account_selected) accountSelect(refresh_accounts);
                        continue;
                    }

                    let refresh_accounts = await Mojang.refresh(account);

                    if (refresh_accounts.error) {
                        this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            this.db.updateData('configClient', configClient);
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID;
                    this.db.updateData('accounts', refresh_accounts, account_ID);
                    await addAccount(refresh_accounts);
                    if (account_ID == account_selected) accountSelect(refresh_accounts);
                } else if (account.meta.type == "CYLREBORN") {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name} | UUID: ${account.uuid} | Email: ${account.email} | Access Token: ${account.access_token}`);
                    popupRefresh.openPopup({
                        title: 'Connexion',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    let refresh_accounts = await fetch("https://api.craftyourliferp.fr/verify", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            access_token: account.access_token
                        })
                    });

                    if (refresh_accounts.status !== 200) {
                        this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            this.db.updateData('configClient', configClient);
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage} 2`);
                        continue;
                    }
                    refresh_accounts = await refresh_accounts.json();

                    console.log(refresh_accounts.username !== account.name);
                    console.log(refresh_accounts.email !== account.email);
                    console.log(refresh_accounts.uuid !== account.client_token);

                    if (refresh_accounts.username !== account.name || refresh_accounts.uuid !== account.client_token) {
                        this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            this.db.updateData('configClient', configClient);
                        }
                        console.error(`[Account] ${account.name}: Invalid Account 1`);
                        continue;
                    }
                } else {
                    console.error(`[Account] ${account.name}: Account Type Not Found`);
                    this.db.deleteData('accounts', account_ID);
                    if (account_ID == account_selected) {
                        configClient.account_selected = null;
                        this.db.updateData('configClient', configClient);
                    }
                }
            }

            accounts = await this.db.readAllData('accounts');
            configClient = await this.db.readData('configClient');
            account_selected = configClient ? configClient.account_selected : null;

            if (!account_selected) {
                let uuid = accounts[0].ID;
                if (uuid) {
                    configClient.account_selected = uuid;
                    await this.db.updateData('configClient', configClient);
                    accountSelect(uuid);
                }
            }

            if (!accounts.length) {
                config.account_selected = null;
                await this.db.updateData('configClient', config);
                popupRefresh.closePopup();
                return changePanel("login");
            }

            popupRefresh.closePopup();
            changePanel("home");
        } else {
            popupRefresh.closePopup();
            changePanel('login');
        }
    }

    // Ajout des nouvelles méthodes

    calculateMD5(filePath) {
        const fileBuffer = fs.readFileSync(filePath);
        const hashSum = crypto.createHash('md5');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    }

    async obfuscatedCheckModsMD5() {
        var _0x5e8f=["\x61\x62\x63\x64\x65\x66\x67\x68\x69\x6A\x6B\x6C\x6D\x6E\x6F\x70\x71\x72\x73\x74\x75\x76\x77\x78\x79\x7A\x41\x42\x43\x44\x45\x46\x47\x48\x49\x4A\x4B\x4C\x4D\x4E\x4F\x50\x51\x52\x53\x54\x55\x56\x57\x58\x59\x5A\x30\x31\x32\x33\x34\x35\x36\x37\x38\x39\x2E\x2F\x2B\x2D","\x6C\x65\x6E\x67\x74\x68","\x66\x6C\x6F\x6F\x72","\x73\x75\x62\x73\x74\x72\x69\x6E\x67"];(function(_0x2c3724,_0x336998){var _0x166c87=function(_0x312c7b){while(--_0x312c7b){_0x2c3724["\x70\x75\x73\x68"](_0x2c3724["\x73\x68\x69\x66\x74"]());}};_0x166c87(++_0x336998);}(_0x5e8f,0x1d5));var _0x2e8f=function(_0x1b8b8a,_0x4733ab){_0x1b8b8a=_0x1b8b8a-0x0;var _0x5e8fef=_0x5e8f[_0x1b8b8a];return _0x5e8fef;};const modsDir = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}/instances/craftyourliferp/mods`;const mods = fs.readdirSync(modsDir).filter(file => file.endsWith('.jar'));const modsMD5 = {};mods.forEach(mod => {const filePath = `${modsDir}/${mod}`;const fileBuffer = fs.readFileSync(filePath);const hashSum = crypto.createHash('md5');hashSum.update(fileBuffer);modsMD5[mod] = hashSum.digest('hex');});return modsMD5;
    }

    async sendModsMD5() {
        const modsMD5 = await this.obfuscatedCheckModsMD5();
        const playerName = await this.getPlayerName();
        try {
            await axios.post('https://api.craftyourliferp.fr/mods', {
                playerName: playerName,
                mods: modsMD5
            });
            console.log('MD5 des mods envoyés');
            await this.delay(2000); // Attendre 2 secondes pour garantir que les MD5 sont enregistrés
        } catch (error) {
            console.error('Erreur lors de l\'envoi des MD5 :', error);
        }
    }

    async getPlayerName() {
        let configClient = await this.db.readData('configClient');
        let account_selected = configClient.account_selected;
        let account = await this.db.readData('accounts', account_selected);
        return account.name;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

new Launcher().init();
