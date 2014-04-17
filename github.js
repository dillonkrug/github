// Github.js 0.9.0
// (c) 2013 Michael Aufreiter, Development Seed
// Github.js is freely distributable under the MIT license.
// For all details and documentation:
// http://substance.io/michael/github

(function() {

	// Initial Setup
	// -------------

	var XMLHttpRequest, Base64, _;
	if (typeof exports !== 'undefined') {
		XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;
		_ = require('underscore');
		Promise = require('bluebird');
		Base64 = require('./lib/base64.js');
	} else {
		_ = window._;
		Promise = window.Promise;
		Base64 = window.Base64;
	}
	//prefer native XMLHttpRequest always
	if (typeof window !== 'undefined' && typeof window.XMLHttpRequest !== 'undefined') {
		XMLHttpRequest = window.XMLHttpRequest;
	}

	var API_URL = 'https://api.github.com';

	function getURL(path) {
		var url = path.indexOf('//') >= 0 ? path : API_URL + path;
		return url + ((/\?/).test(url) ? '&' : '?') + (new Date()).getTime();
	}

	// HTTP Request Abstraction
	// =======
	// I'm not proud of this and neither should you be if you were responsible for the XMLHttpRequest spec.


	var Github = function(options) {
		this._options = options;
	};

	// Top Level API
	// -------

	Github.prototype = {
		_request: function (method, path, data, raw, includeXHR) {
			var gh = this, data = data || null;

			return new Promise(function(next, fail) {
				var xhr = new XMLHttpRequest();
				if (!raw) xhr.dataType = 'json';
				xhr.open(method, getURL(path));
				xhr.onreadystatechange = function() {
					if (this.readyState != 4) return;
					if (this.status >= 200 && this.status < 300 || this.status === 304) {
						var res = raw ? this.responseText : (this.responseText ? JSON.parse(this.responseText) : true);
						return next(includeXHR ? {res: res, xhr: xhr} : res);
					} else {
						fail({
							path: path,
							request: this,
							error: this.status
						});
					}
				}
				xhr.setRequestHeader('Accept', 'application/vnd.github.raw+json');
				xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
				if ((gh._options.token) || (gh._options.username && gh._options.password)) {
					xhr.setRequestHeader('Authorization', gh._options.token ? 'token ' + gh._options.token : 'Basic ' + Base64.encode(gh._options.username + ':' + gh._options.password));
				}
				xhr.send(data && JSON.stringify(data))
			})
		},
		
		// Github does not always honor the 1000 limit so we want to iterate over the data set.
		_requestAllPages: function (path) {
			var gh = this, results = [];

			return (function iterate(path) {
				return gh._request('GET', path, null, false, true).then(function(req) {
					results.push.apply(results, req.res);
					var links = (req.xhr.getResponseHeader('link') || '').split(/\s*,\s*/g),
						next = _.find(links, function(link) { return /rel='next'/.test(link) });

					next = next && (/<(.*)>/.exec(next) || [])[1];
					if (!next) return false;
					return iterate(next);
				});				
			}(path)).then(function() {
				return results;
			});
		},

		getIssues: function(user, repo) {
			return new Github.Issue(this, { user: user, repo: repo });
		},

		getRepo: function(user, repo) {
			return new Github.Repository(this, {user: user, name: repo });
		},

		getUser: function() {
			return new Github.User(this);
		},

		getGist: function(id) {
			return new Github.Gist(this, { id: id });
		}
	}



	// User API
	// =======

	Github.User = function(gh) {
		this.gh = gh;
	};

	Github.User.prototype = {
		repos: function() { return this.gh._requestAllPages('/user/repos?type=all&per_page=1000&sort=updated') }, //.then(function(repos) { return {repos:repos} }) },

		// List user organizations
		orgs: function() { return this.gh._request('GET', '/user/orgs') },

		// List authenticated user's gists
		gists: function() { return this.gh._request('GET', '/gists') },

		// List authenticated user's unread notifications
		notifications: function() { return this.gh._request('GET', '/notifications') },

		// Show user information
		show: function(username) {
			var command = username ? '/users/' + username : '/user';
			return this.gh._request('GET', command)
		},

		// List user repositories
		userRepos: function(username) { return this.gh._requestAllPages('/users/' + username + '/repos?type=all&per_page=1000&sort=updated') },

		// List a user's gists
		userGists: function(username) { return this.gh._request('GET', '/users/' + username + '/gists') },

		// List organization repositories
		orgRepos: function(orgname) { return this.gh._requestAllPages('/orgs/' + orgname + '/repos?type=all&&page_num=1000&sort=updated&direction=desc') },

		// Follow user
		follow: function(username) { return this.gh._request('PUT', '/user/following/' + username) },

		// Unfollow user
		unfollow: function(username) { return this.gh._request('DELETE', '/user/following/' + username) }

	}


	// Repository API
	// =======

	Github.Repository = function(gh, options) {
		this.gh = gh;
		this._repo = options.name;
		this._user = options.user;
		this._repoPath = '/repos/' + options.user  + '/' + options.name;
		this._currentTree = {
			'branch': null,
			'sha': null
		};
	}

	Github.Repository.prototype = {
		_updateTree: function (branch) {
			var currentTree = this._currentTree;
			
			// Uses the cache if branch has not been changed
			if (branch === currentTree.branch && currentTree.sha) return Promise.fulfilled(currentTree.sha);
			
			return this.getRef('heads/' + branch).then(function(sha) {
				currentTree.branch = branch;
				currentTree.sha = sha;
				return sha;
			});
		},
		// Get a particular reference
		getRef: function(ref) {
			return this.gh._request('GET', this._repoPath + '/git/refs/' + ref).then(function(res) {
				return res.object.sha;
			})
		},

		// Create a new reference
		// {
		//   'ref': 'refs/heads/my-new-branch-name',
		//   'sha': '827efc6d56897b048c772eb4087f854f46256132'
		// }

		createRef: function(options) {
			return this.gh._request('POST', this._repoPath + '/git/refs', options);
		},


		// Delete a reference
		// repo.deleteRef('heads/gh-pages')
		// repo.deleteRef('tags/v1.0')

		deleteRef: function(ref) {
			return this.gh._request('DELETE', this._repoPath + '/git/refs/' + ref, options);
		},

		// Create a repo  
		createRepo: function(options) {
			return this.gh._request('POST', '/user/repos', options);
		},

		// Delete a repo  
		deleteRepo: function() {
			return this.gh._request('DELETE', this._repoPath, {name: this._name, user: this._user});
		},

		// List all tags of a repository
		listTags: function() {
			return this.gh._request('GET', this._repoPath + '/tags')
		},

		// List all pull requests of a respository
		listPulls: function(state) {
			return this.gh._request('GET', this._repoPath + '/pulls' + (state ? '?state=' + state : ''))
		},

		// Gets details for a specific pull request
		getPull: function(number) {
			return this.gh._request('GET', this._repoPath + '/pulls/' + number)
		},

		// Retrieve the changes made between base and head
		compare: function(base, head) {
			return this.gh._request('GET', this._repoPath + '/compare/' + base + '...' + head)
		},

		// List all branches of a repository
		listBranches: function() {
			return this.gh._request('GET', this._repoPath + '/git/refs/heads').then(function(heads) {
				return _.map(heads, function(head) { return _.last(head.ref.split('/')) });
			});
		},

		// Retrieve the contents of a blob
		getBlob: function(sha) {
			return this.gh._request('GET', this._repoPath + '/git/blobs/' + sha, null, 'raw');
		},

		// Get contents
		contents: function(branch, path) {
			return this.gh._request('GET', this._repoPath + '/contents' + (path || '') + '?ref=' + branch, null, path[path.length-1] == '/' ? false : 'raw');
		},

		// For a given file path, get the corresponding sha (blob for files, tree for dirs)
		getSha: function(branch, path) {
			// Just use head if path is empty
			if (path === '') return this.getRef('heads/' + branch);
			return this.getTree(branch + '?recursive=true').then(function(tree) {
				var file = _.select(tree, function(file) { return file.path === path; })[0];
				return file ? file.sha : null;
			});
		},

		// Retrieve the tree a commit points to
		getTree: function(tree) {
			return this.gh._request('GET', this._repoPath + '/git/trees/' + tree).then(function(res) {
				return res.tree;
			});
		},

		// Post a new blob object, getting a blob SHA back
		postBlob: function(content) {
			if (typeof(content) === 'string') {
				content = {
					'content': content,
					'encoding': 'utf-8'
				};
			} else {
				content = {
					'content': btoa(String.fromCharCode.apply(null, new Uint8Array(content))),
					'encoding': 'base64'
				};
			}

			return this.gh._request('POST', repoPath + '/git/blobs', content).then(function(res) {
				return res.sha;
			});
		},

		// Update an existing tree adding a new blob object getting a tree SHA back
		updateTree: function(baseTree, path, blob) {
			var data = {
				'base_tree': baseTree,
				'tree': [{
					'path': path,
					'mode': '100644',
					'type': 'blob',
					'sha': blob
				}]
			};
			return this.gh._request('POST', this._repoPath + '/git/trees', data).then(function(res) {
				return res.sha;
			});
		},

		// Post a new tree object having a file path pointer replaced
		// with a new blob SHA getting a tree SHA back
		postTree: function(tree) {
			return this.gh._request('POST', repoPath + '/git/trees', {
				'tree': tree
			}).then(function(res) {
				return res.sha;
			});
		},

		// Create a new commit object with the current commit SHA as the parent
		// and the new tree SHA, getting a commit SHA back
		commit: function(parent, tree, message) {
			var repo = this, data = {
				'message': message,
				'author': {
					'name': this.gh.username
				},
				'parents': [
					parent
				],
				'tree': tree
			};

			return this.gh._request('POST', this._repoPath + '/git/commits', data).then(function(res) {
				repo._currentTree.sha = res.sha; // update latest commit
				return res.sha;
			});
		},

		// Update the reference of your head to point to the new commit SHA
		updateHead: function(head, commit) {
			return this.gh._request('PATCH', this._repoPath + '/git/refs/heads/' + head, {
				'sha': commit
			});
		},

		// Show repository information
		show: function() {
			return this.gh._request('GET', this._repoPath);
		},

		// Fork repository
		fork: function() {
			return this.gh._request('POST', this._repoPath + '/forks');
		},

		// Branch repository  
		branch: function(oldBranch, newBranch) {
			if (arguments.length === 1) {
				newBranch = oldBranch;
				oldBranch = 'master';
			}
			var repo = this;
			return this.getRef('heads/' + oldBranch).then(function(ref) {
				return repo.createRef({
					ref: 'refs/heads/' + newBranch,
					sha: ref
				});
			});
		},

		// Create pull request
		createPullRequest: function(options) {
			return this.gh._request('POST', this._repoPath + '/pulls', options);
		},

		// List hooks
		listHooks: function() {
			return this.gh._request('GET', this._repoPath + '/hooks');
		},

		// Get a hook
		getHook: function(id) {
			return this.gh._request('GET', this._repoPath + '/hooks/' + id);
		},

		// Create a hook
		createHook: function(options, cb) {
			return this.gh._request('POST', this._repoPath + '/hooks', options);
		},

		// Edit a hook
		editHook: function(id, options) {
			return this.gh._request('PATCH', this._repoPath + '/hooks/' + id, options);
		},

		// Delete a hook
		deleteHook: function(id, cb) {
			return this.gh._request('DELETE', this._repoPath + '/hooks/' + id);
		},

		// Read file at given path
		read: function(branch, path) {
			var repo = this, sha;
			return repo.getSha(branch, path).then(function(res) {
				sha = res;
				return repo.getBlob(sha)
			}).then(function(content) {
				return {
					sha: sha,
					content: content
				}
			});
		},

		// Remove a file from the tree
		remove: function(branch, path, cb) {
			var repo = this, latestCommit;
			return repo._updateTree(branch).then(function(latest) {
				latestCommit = latest;
				return repo.getTree(latestCommit + '?recursive=true');
			}).then(function(tree) {
				// Update Tree
				var newTree = _.reject(tree, function(ref) { return ref.path === path });
				
				_.each(newTree, function(ref) { if (ref.type === 'tree') delete ref.sha  });

				return repo.postTree(newTree);
			}).then(function(rootTree) {
				return repo.commit(latestCommit, rootTree, 'Deleted ' + path)
			}).then(function(commit) {
				return repo.updateHead(branch, commit)
			});
		},

		// Delete a file from the tree
		delete: function(branch, path, cb) {
			return this.getSha(branch, path).then(function(sha) {
				if (!sha) return cb('not found', null);
				var delPath = this._repoPath + '/contents/' + path;
				var params = {
					'message': 'Deleted ' + path,
					'sha': sha
				};
				delPath += '?message=' + encodeURIComponent(params.message);
				delPath += '&sha=' + encodeURIComponent(params.sha);
				return this.gh._request('DELETE', delPath);
			});
		},

		// Move a file to a new location
		move: function(branch, path, newPath, cb) {
			var repo = this, latestCommit;
			return repo._updateTree(branch).then(function(latest) {
				latestCommit = latest;
				return repo.getTree(latestCommit + '?recursive=true')
			}).then(function(tree) {
				// Update Tree
				_.each(tree, function(ref) {
					if (ref.path === path) ref.path = newPath;
					if (ref.type === 'tree') delete ref.sha;
				});

				return repo.postTree(tree);
			}).then(function(rootTree) {
				return repo.commit(latestCommit, rootTree, 'Deleted ' + path);
			}).then(function(commit) {
				return repo.updateHead(branch, commit);
			});
		},

		// Write file contents to a given branch and path
		write: function(branch, path, content, message) {
			var repo = this, latestCommit;
			return repo._updateTree(branch).then(function(latest) {
				latestCommit = latest;
				return repo.postBlob(content);
			}).then(function(blob) {
				return repo.updateTree(latestCommit, path, blob);
			}).then(function(tree) {
				return repo.commit(latestCommit, tree, message)
			}).then(function(commit) {
				return repo.updateHead(branch, commit);
			});
		},

		// List commits on a repository. Takes an object of optional paramaters:
		// sha: SHA or branch to start listing commits from
		// path: Only commits containing this file path will be returned
		// since: ISO 8601 date - only commits after this date will be returned
		// until: ISO 8601 date - only commits before this date will be returned
		getCommits: function(options) {
			options = options || {};
			var url = this._repoPath + '/commits';
			var params = [];
			if (options.sha) {
				params.push('sha=' + encodeURIComponent(options.sha));
			}
			if (options.path) {
				params.push('path=' + encodeURIComponent(options.path));
			}
			if (options.since) {
				var since = options.since;
				if (since.constructor === Date) {
					since = since.toISOString();
				}
				params.push('since=' + encodeURIComponent(since));
			}
			if (options.until) {
				var until = options.until;
				if (until.constructor === Date) {
					until = until.toISOString();
				}
				params.push('until=' + encodeURIComponent(until));
			}
			if (params.length > 0) {
				url += '?' + params.join('&');
			}
			return this.gh._request('GET', url, null);
		}

	};

	// Gists API
	// =======

	Github.Gist = function(gh, options) {
		this.gh = gh;
		var id = options.id;
		this._gistPath = '/gists/' + id;
	}

	Github.Gist.prototype = {
		// Read the gist
		read: function() {
			return this.gh._request('GET', this._gistPath)
		},

		// Create the gist
		// {
		//  'description': 'the description for this gist',
		//    'public': true,
		//    'files': {
		//      'file1.txt': {
		//        'content': 'String file contents'
		//      }
		//    }
		// }
		create: function(options) {
			return this.gh._request('POST', '/gists', options);
		},

		// Delete the gist
		delete: function() {
			return this.gh._request('DELETE', this._gistPath);
		},
		
		// Fork a gist
		fork: function() {
			return this.gh._request('POST', this._gistPath + '/fork')
		},

		// Update a gist with the new stuff
		update: function(options) {
			return this.gh._request('PATCH', this._gistPath, options)
		},

		// Star a gist
		star: function() {
			return this.gh._request('PUT', this._gistPath + '/star')
		},

		// Untar a gist
		unstar: function() {
			return this.gh._request('DELETE', this._gistPath + '/star')
		},

		// Check if a gist is starred
		// --------

		isStarred: function() {
			return this.gh._request('GET', this._gistPath + '/star')
		}
	};

	// Issues API
	// ==========

	Github.Issue = function(gh, options) {
		this.gh = gh;
		this._path = '/repos/' + options.user + '/' + options.repo + '/issues';
	};

	Github.Issue.prototype = {
		list: function(options) {
			return this.gh._request('GET', this._path, options)
		}
	}




	if (typeof exports !== 'undefined') {
		// Github = exports;
		module.exports = Github;
	} else {
		window.Github = Github;
	}
}).call(this);