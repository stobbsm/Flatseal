/* applications.js
 *
 * Copyright 2020 Martin Abente Lahaye
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const {GObject, GLib, Gio} = imports.gi;


var FlatpakApplicationsModel = GObject.registerClass({
    GTypeName: 'FlatpakApplicationsModel',
}, class FlatpakApplicationsModel extends GObject.Object {
    _init() {
        super._init({});
        this._paths = null;

        this._systemPath = GLib.build_filenamev([
            GLib.DIR_SEPARATOR_S, 'var', 'lib', 'flatpak',
        ]);
        this._userPath = GLib.build_filenamev([
            GLib.get_home_dir(), '.local', 'share', 'flatpak',
        ]);
        this._configPath = GLib.build_filenamev([
            GLib.DIR_SEPARATOR_S, 'run', 'host', 'etc', 'flatpak', 'installations.d',
        ]);
    }

    static _parseCustomInstallation(path) {
        const installations = [];

        const keyFile = new GLib.KeyFile();
        keyFile.load_from_file(path, GLib.KeyFileFlags.NONE);

        const [groups] = keyFile.get_groups();
        groups.forEach(group => {
            const installation = {};

            try {
                installation['path'] = keyFile.get_value(group, 'Path');
            } catch (err) {
                return;
            }

            try {
                installation['priority'] = keyFile.get_value(group, 'Priority');
            } catch (err) {
                installation['priority'] = 0;
            }

            installations.push(installation);
        });

        return installations;
    }

    _getCustomInstallationsPaths() {
        var installations = [];

        if (GLib.access(this._configPath, 0) !== 0)
            return installations;

        const directory = Gio.File.new_for_path(this._configPath);
        const enumerator = directory.enumerate_children('*', Gio.FileQueryInfoFlags.NONE, null);
        var info = enumerator.next_file(null);

        while (info !== null) {
            const file = enumerator.get_child(info);
            installations = [
                ...installations,
                ...this.constructor._parseCustomInstallation(file.get_path()),
            ];
            info = enumerator.next_file(null);
        }

        return installations
            .sort((a, b) => b.priority - a.priority)
            .map(e => e.path);
    }

    _getInstallationsPaths() {
        if (this._paths !== null)
            return this._paths;

        /* Installation priority is handled by this list order */
        this._paths = this._getCustomInstallationsPaths();
        this._paths.unshift(this._userPath);
        this._paths.push(this._systemPath);

        return this._paths;
    }

    _getBundlePathForAppId(appId) {
        return this._getInstallationsPaths()
            .map(p => GLib.build_filenamev([p, 'app', appId, 'current', 'active']))
            .find(p => GLib.access(p, 0) === 0);
    }

    static _getApproximateNameForAppId(appId) {
        const name = appId.split('.').pop();
        return name.replace(/^\w/, c => c.toUpperCase());
    }

    _getNameForAppId(appId) {
        const key = 'Name';
        const group = 'Desktop Entry';
        const path = GLib.build_filenamev([
            this._getBundlePathForAppId(appId),
            'files', 'share', 'applications', `${appId}.desktop`,
        ]);

        if (GLib.access(path, 0) !== 0)
            return this.constructor._getApproximateNameForAppId(appId);

        const keyFile = new GLib.KeyFile();
        keyFile.load_from_file(path, 0);

        if (!keyFile.has_group(group))
            return this.constructor._getApproximateNameForAppId(appId);

        return keyFile.get_value(group, key);
    }

    _getIconThemePathForAppId(appId) {
        return GLib.build_filenamev([
            this._getBundlePathForAppId(appId), 'files', 'share', 'icons',
        ]);
    }

    /* XXX this only covers cases that follow the flathub convention */
    static _isBaseApp(appId) {
        return appId.endsWith('.BaseApp');
    }

    _getApplicationsForPath(path) {
        const list = [];

        if (GLib.access(path, 0) !== 0)
            return list;

        const directory = Gio.File.new_for_path(path);
        const enumerator = directory.enumerate_children('*', Gio.FileQueryInfoFlags.NONE, null);
        var info = enumerator.next_file(null);

        while (info !== null) {
            const file = enumerator.get_child(info);
            const appId = GLib.path_get_basename(file.get_path());
            const activePath = GLib.build_filenamev([file.get_path(), 'current', 'active']);

            if (!this.constructor._isBaseApp(appId) && GLib.access(activePath, 0) === 0)
                list.push(appId);

            info = enumerator.next_file(null);
        }
        return list;
    }

    getAll() {
        const installations = this._getInstallationsPaths();
        var applications = [];

        installations.forEach(path => {
            const app = GLib.build_filenamev([path, 'app']);
            applications = [...applications, ...this._getApplicationsForPath(app)];
        });

        const union = new Set(applications);
        const list = [...union];

        list.sort();

        return list.map(appId => {
            return {
                appId: appId,
                appThemePath: this._getIconThemePathForAppId(appId),
                appName: this._getNameForAppId(appId),
            };
        });
    }

    getMetadataPathForAppId(appId) {
        return GLib.build_filenamev([this._getBundlePathForAppId(appId), 'metadata']);
    }

    get userPath() {
        return this._userPath;
    }

    /* testing */

    set userPath(path) {
        this._userPath = path;
    }

    set systemPath(path) {
        this._systemPath = path;
    }

    set configPath(path) {
        this._configPath = path;
    }
});
