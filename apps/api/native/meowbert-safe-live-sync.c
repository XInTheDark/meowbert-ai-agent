#define _GNU_SOURCE

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

/*
 * This helper is the live-sync filesystem boundary. Node's pathname APIs cannot
 * make a checked parent directory stay checked while another process renames it.
 * openat2 resolves the complete relative path from an already-open environment
 * root and rejects every symlink component in that single kernel operation. The
 * configured root path must contain only real directories: opening its complete
 * path with RESOLVE_NO_SYMLINKS prevents a task from retargeting the root or an
 * ancestor between configuration lookup and this operation.
 */

static void fail_errno(const char *message) {
  fprintf(stderr, "%s: %s\n", message, strerror(errno));
  exit(1);
}

static void fail_message(const char *message) {
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static int open_beneath(int dirfd, const char *relative_path, int flags, mode_t mode) {
  struct open_how how = {
    .flags = (unsigned long long) flags,
    .mode = mode,
    .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS
  };
  return (int) syscall(SYS_openat2, dirfd, relative_path, &how, sizeof(how));
}

static int open_path_without_symlinks(const char *path, int flags, mode_t mode) {
  struct open_how how = {
    .flags = (unsigned long long) flags,
    .mode = mode,
    .resolve = RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS
  };
  return (int) syscall(SYS_openat2, AT_FDCWD, path, &how, sizeof(how));
}

#ifdef MEOWBERT_SAFE_LIVE_SYNC_TEST_HOOK
static void pause_at_test_barrier(const char *expected_barrier) {
  const char *requested_barrier = getenv("MEOWBERT_SAFE_LIVE_SYNC_TEST_BARRIER");
  if (!requested_barrier || strcmp(requested_barrier, expected_barrier) != 0) {
    return;
  }
  const char *ready_fd_value = getenv("MEOWBERT_SAFE_LIVE_SYNC_READY_FD");
  const char *continue_fd_value = getenv("MEOWBERT_SAFE_LIVE_SYNC_CONTINUE_FD");
  if (!ready_fd_value || !continue_fd_value) {
    return;
  }
  int ready_fd = atoi(ready_fd_value);
  int continue_fd = atoi(continue_fd_value);
  if (write(ready_fd, "1", 1) != 1) {
    fail_errno("Unable to signal live sync test barrier");
  }
  char signal;
  if (read(continue_fd, &signal, 1) != 1) {
    fail_errno("Unable to resume live sync test barrier");
  }
}
#else
static void pause_at_test_barrier(const char *expected_barrier) {
  (void) expected_barrier;
}
#endif

static void require_safe_relative_path(const char *relative_path) {
  if (!relative_path || relative_path[0] == '\0' || relative_path[0] == '/') {
    fail_message("Live sync path must be a non-empty relative path");
  }

  const char *segment_start = relative_path;
  for (const char *cursor = relative_path; ; cursor += 1) {
    if (*cursor != '/' && *cursor != '\0') {
      continue;
    }
    size_t segment_length = (size_t) (cursor - segment_start);
    if (segment_length == 0
      || (segment_length == 1 && segment_start[0] == '.')
      || (segment_length == 2 && segment_start[0] == '.' && segment_start[1] == '.')) {
      fail_message("Live sync path contains an unsafe segment");
    }
    if (*cursor == '\0') {
      return;
    }
    segment_start = cursor + 1;
  }
}

static int open_environment_root(const char *root_path) {
  if (!root_path || root_path[0] != '/') {
    fail_message("Live sync environment root must be an absolute path");
  }
  pause_at_test_barrier("before-root-open");
  int rootfd = open_path_without_symlinks(root_path, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC, 0);
  if (rootfd < 0) {
    fail_errno("Unable to open live sync environment root");
  }
  struct stat root_stats;
  if (fstat(rootfd, &root_stats) != 0 || !S_ISDIR(root_stats.st_mode)) {
    fail_message("Live sync environment root must be a real directory");
  }
  pause_at_test_barrier("after-root-open");
  return rootfd;
}

static void split_relative_path(const char *relative_path, char **parent_path, char **name) {
  char *copy = strdup(relative_path);
  if (!copy) {
    fail_errno("Unable to allocate live sync path");
  }
  char *separator = strrchr(copy, '/');
  if (!separator) {
    *parent_path = strdup(".");
    *name = copy;
    return;
  }
  *separator = '\0';
  *parent_path = strdup(copy);
  *name = strdup(separator + 1);
  free(copy);
  if (!*parent_path || !*name) {
    fail_errno("Unable to allocate live sync path");
  }
}

static int open_or_create_directory_path(int rootfd, const char *parent_path) {
  int currentfd = dup(rootfd);
  if (currentfd < 0) {
    fail_errno("Unable to duplicate live sync environment root");
  }
  if (strcmp(parent_path, ".") == 0) {
    return currentfd;
  }

  char *path_copy = strdup(parent_path);
  if (!path_copy) {
    fail_errno("Unable to allocate live sync directory path");
  }
  char *save_pointer = NULL;
  for (char *segment = strtok_r(path_copy, "/", &save_pointer); segment; segment = strtok_r(NULL, "/", &save_pointer)) {
    int created_directory = 0;
    int nextfd = open_beneath(currentfd, segment, O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
    if (nextfd < 0 && errno == ENOENT) {
      if (mkdirat(currentfd, segment, 02775) != 0 && errno != EEXIST) {
        fail_errno("Unable to create live sync parent directory");
      }
      created_directory = 1;
      nextfd = open_beneath(currentfd, segment, O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
    }
    if (nextfd < 0) {
      fail_errno("Live sync parent directory is unsafe or unavailable");
    }
    if (created_directory && fchmod(nextfd, 02775) != 0) {
      fail_errno("Unable to set live sync parent directory permissions");
    }
    close(currentfd);
    currentfd = nextfd;
  }
  free(path_copy);
  return currentfd;
}

static int open_parent_directory(int rootfd, const char *relative_path, char **final_name, int create_parents) {
  char *parent_path = NULL;
  split_relative_path(relative_path, &parent_path, final_name);
  int parentfd = create_parents
    ? open_or_create_directory_path(rootfd, parent_path)
    : open_beneath(rootfd, parent_path, O_PATH | O_DIRECTORY | O_CLOEXEC, 0);
  free(parent_path);
  if (parentfd < 0) {
    fail_errno("Live sync parent directory is unsafe or unavailable");
  }
  return parentfd;
}

static void copy_fd(int source_fd, int destination_fd) {
  char buffer[65536];
  while (1) {
    ssize_t read_count = read(source_fd, buffer, sizeof(buffer));
    if (read_count == 0) {
      return;
    }
    if (read_count < 0) {
      if (errno == EINTR) {
        continue;
      }
      fail_errno("Unable to read live sync file data");
    }
    for (ssize_t offset = 0; offset < read_count; ) {
      ssize_t written_count = write(destination_fd, buffer + offset, (size_t) (read_count - offset));
      if (written_count < 0) {
        if (errno == EINTR) {
          continue;
        }
        fail_errno("Unable to write live sync file data");
      }
      offset += written_count;
    }
  }
}

static void make_temporary_name(char *buffer, size_t buffer_size, const char *prefix) {
  unsigned long long random_value = 0;
  if (getrandom(&random_value, sizeof(random_value), 0) != (ssize_t) sizeof(random_value)) {
    random_value = ((unsigned long long) time(NULL) << 32) ^ (unsigned long long) getpid();
  }
  snprintf(buffer, buffer_size, ".%s.live-sync-%llx", prefix, random_value);
}

static void require_file_target(int parentfd, const char *name, int replace_existing) {
  struct stat target_stats;
  if (fstatat(parentfd, name, &target_stats, AT_SYMLINK_NOFOLLOW) == 0) {
    if (!replace_existing) {
      errno = EEXIST;
      fail_errno("Live sync target already exists");
    }
    if (S_ISLNK(target_stats.st_mode)) {
      fail_message("Live sync target cannot be a symbolic link");
    }
    if (!S_ISREG(target_stats.st_mode)) {
      fail_message("Live sync target is not a regular file");
    }
    return;
  }
  if (errno != ENOENT) {
    fail_errno("Unable to inspect live sync target");
  }
}

static void write_file_from_stdin(const char *root_path, const char *relative_path, int replace_existing, int create_parents) {
  require_safe_relative_path(relative_path);
  int rootfd = open_environment_root(root_path);
  char *final_name = NULL;
  int parentfd = open_parent_directory(rootfd, relative_path, &final_name, create_parents);
  char temporary_name[128];
  make_temporary_name(temporary_name, sizeof(temporary_name), final_name);

  int temporary_fd = openat(parentfd, temporary_name, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0664);
  if (temporary_fd < 0) {
    fail_errno("Unable to create live sync temporary file");
  }
  copy_fd(STDIN_FILENO, temporary_fd);
  if (fsync(temporary_fd) != 0 || fchmod(temporary_fd, 0664) != 0) {
    fail_errno("Unable to finalize live sync temporary file");
  }
  if (close(temporary_fd) != 0) {
    fail_errno("Unable to close live sync temporary file");
  }

  require_file_target(parentfd, final_name, replace_existing);
  if (renameat(parentfd, temporary_name, parentfd, final_name) != 0) {
    fail_errno("Unable to install live sync file");
  }
  free(final_name);
  close(parentfd);
  close(rootfd);
}

static void apply_source_timestamps(int destination_fd, const struct stat *source_stats) {
  struct timespec timestamps[2] = { source_stats->st_atim, source_stats->st_mtim };
  if (futimens(destination_fd, timestamps) != 0) {
    fail_errno("Unable to preserve live sync timestamps");
  }
}

static void copy_tree(int source_directory_fd, int destination_directory_fd, mode_t directory_mode, mode_t file_mode);

static void copy_tree_entry(int source_directory_fd, int destination_directory_fd, const char *name, mode_t directory_mode, mode_t file_mode) {
  struct stat entry_stats;
  if (fstatat(source_directory_fd, name, &entry_stats, AT_SYMLINK_NOFOLLOW) != 0) {
    fail_errno("Unable to inspect staged live sync entry");
  }
  if (S_ISLNK(entry_stats.st_mode)) {
    fail_message("Staged live sync tree cannot contain symbolic links");
  }
  if (S_ISDIR(entry_stats.st_mode)) {
    if (mkdirat(destination_directory_fd, name, directory_mode) != 0) {
      fail_errno("Unable to create live sync directory");
    }
    int source_child_fd = openat(source_directory_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    int destination_child_fd = openat(destination_directory_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (source_child_fd < 0 || destination_child_fd < 0) {
      fail_errno("Unable to open live sync directory");
    }
    struct stat opened_source_stats;
    if (fstat(source_child_fd, &opened_source_stats) != 0) {
      fail_errno("Unable to inspect staged live sync directory");
    }
    copy_tree(source_child_fd, destination_child_fd, directory_mode, file_mode);
    if (fchmod(destination_child_fd, directory_mode) != 0) {
      fail_errno("Unable to finalize live sync directory permissions");
    }
    apply_source_timestamps(destination_child_fd, &opened_source_stats);
    close(source_child_fd);
    close(destination_child_fd);
    return;
  }
  if (!S_ISREG(entry_stats.st_mode)) {
    fail_message("Staged live sync tree contains an unsupported entry");
  }

  int source_file_fd = openat(source_directory_fd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  int destination_file_fd = openat(destination_directory_fd, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, file_mode);
  if (source_file_fd < 0 || destination_file_fd < 0) {
    fail_errno("Unable to open staged live sync file");
  }
  copy_fd(source_file_fd, destination_file_fd);
  struct stat opened_source_stats;
  if (fstat(source_file_fd, &opened_source_stats) != 0) {
    fail_errno("Unable to inspect staged live sync file");
  }
  if (fsync(destination_file_fd) != 0 || fchmod(destination_file_fd, file_mode) != 0) {
    fail_errno("Unable to finalize live sync file");
  }
  apply_source_timestamps(destination_file_fd, &opened_source_stats);
  close(source_file_fd);
  close(destination_file_fd);
}

static void copy_tree(int source_directory_fd, int destination_directory_fd, mode_t directory_mode, mode_t file_mode) {
  int source_directory_copy = dup(source_directory_fd);
  if (source_directory_copy < 0) {
    fail_errno("Unable to duplicate staged live sync directory");
  }
  DIR *directory = fdopendir(source_directory_copy);
  if (!directory) {
    fail_errno("Unable to read staged live sync directory");
  }
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    copy_tree_entry(source_directory_fd, destination_directory_fd, entry->d_name, directory_mode, file_mode);
  }
  closedir(directory);
}

static void snapshot_item(const char *root_path, const char *relative_path, const char *staged_path) {
  require_safe_relative_path(relative_path);
  int rootfd = open_environment_root(root_path);
  int sourcefd = open_beneath(rootfd, relative_path, O_RDONLY | O_CLOEXEC, 0);
  if (sourcefd < 0) {
    fail_errno("Live sync source is unsafe or unavailable");
  }
  struct stat source_stats;
  if (fstat(sourcefd, &source_stats) != 0) {
    fail_errno("Unable to inspect live sync source");
  }

  if (S_ISREG(source_stats.st_mode)) {
    int destinationfd = open(staged_path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (destinationfd < 0) {
      fail_errno("Unable to create staged live sync file");
    }
    copy_fd(sourcefd, destinationfd);
    if (fsync(destinationfd) != 0 || fchmod(destinationfd, 0600) != 0) {
      fail_errno("Unable to finalize staged live sync file");
    }
    apply_source_timestamps(destinationfd, &source_stats);
    close(destinationfd);
    close(sourcefd);
    close(rootfd);
    return;
  }

  if (!S_ISDIR(source_stats.st_mode)) {
    fail_message("Live sync source must be a regular file or directory");
  }
  if (mkdir(staged_path, 0700) != 0) {
    fail_errno("Unable to create staged live sync directory");
  }
  int destinationfd = open(staged_path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (destinationfd < 0) {
    fail_errno("Unable to open staged live sync directory");
  }
  copy_tree(sourcefd, destinationfd, 0700, 0600);
  if (fchmod(destinationfd, 0700) != 0) {
    fail_errno("Unable to finalize staged live sync directory permissions");
  }
  apply_source_timestamps(destinationfd, &source_stats);
  close(destinationfd);
  close(sourcefd);
  close(rootfd);
}

static void remove_tree_contents(int directory_fd) {
  int directory_copy = dup(directory_fd);
  if (directory_copy < 0) {
    fail_errno("Unable to duplicate live sync directory");
  }
  DIR *directory = fdopendir(directory_copy);
  if (!directory) {
    fail_errno("Unable to read live sync directory");
  }
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
      continue;
    }
    struct stat entry_stats;
    if (fstatat(directory_fd, entry->d_name, &entry_stats, AT_SYMLINK_NOFOLLOW) != 0) {
      fail_errno("Unable to inspect live sync cleanup entry");
    }
    if (S_ISDIR(entry_stats.st_mode)) {
      int child_fd = openat(directory_fd, entry->d_name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      if (child_fd < 0) {
        fail_errno("Unable to open live sync cleanup directory");
      }
      remove_tree_contents(child_fd);
      close(child_fd);
      if (unlinkat(directory_fd, entry->d_name, AT_REMOVEDIR) != 0) {
        fail_errno("Unable to remove live sync cleanup directory");
      }
      continue;
    }
    if (unlinkat(directory_fd, entry->d_name, 0) != 0) {
      fail_errno("Unable to remove live sync cleanup entry");
    }
  }
  closedir(directory);
}

static void remove_tree_at(int parentfd, const char *name) {
  int directory_fd = openat(parentfd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (directory_fd < 0) {
    fail_errno("Unable to open live sync cleanup target");
  }
  remove_tree_contents(directory_fd);
  close(directory_fd);
  if (unlinkat(parentfd, name, AT_REMOVEDIR) != 0) {
    fail_errno("Unable to remove live sync cleanup target");
  }
}

static void replace_tree(const char *root_path, const char *relative_path, const char *staged_path, int create_parents) {
  require_safe_relative_path(relative_path);
  int rootfd = open_environment_root(root_path);
  char *final_name = NULL;
  int parentfd = open_parent_directory(rootfd, relative_path, &final_name, create_parents);
  int sourcefd = open(staged_path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (sourcefd < 0) {
    fail_errno("Unable to open staged live sync tree");
  }

  char temporary_name[128];
  make_temporary_name(temporary_name, sizeof(temporary_name), final_name);
  if (mkdirat(parentfd, temporary_name, 02775) != 0) {
    fail_errno("Unable to create live sync temporary directory");
  }
  int temporaryfd = openat(parentfd, temporary_name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (temporaryfd < 0) {
    fail_errno("Unable to open live sync temporary directory");
  }
  copy_tree(sourcefd, temporaryfd, 02775, 0664);
  if (fchmod(temporaryfd, 02775) != 0) {
    fail_errno("Unable to finalize live sync temporary directory");
  }
  close(sourcefd);
  close(temporaryfd);

  struct stat target_stats;
  int target_exists = fstatat(parentfd, final_name, &target_stats, AT_SYMLINK_NOFOLLOW) == 0;
  if (!target_exists && errno != ENOENT) {
    fail_errno("Unable to inspect live sync folder target");
  }
  if (target_exists && (!S_ISDIR(target_stats.st_mode) || S_ISLNK(target_stats.st_mode))) {
    fail_message("Live sync folder target must be a non-symlink directory");
  }

  char backup_name[128];
  make_temporary_name(backup_name, sizeof(backup_name), "backup");
  int moved_existing_target = 0;
  if (target_exists) {
    if (renameat(parentfd, final_name, parentfd, backup_name) != 0) {
      fail_errno("Unable to move existing live sync folder");
    }
    moved_existing_target = 1;
  }
  if (renameat(parentfd, temporary_name, parentfd, final_name) != 0) {
    if (moved_existing_target) {
      renameat(parentfd, backup_name, parentfd, final_name);
    }
    fail_errno("Unable to install live sync folder");
  }
  if (moved_existing_target) {
    remove_tree_at(parentfd, backup_name);
  }
  free(final_name);
  close(parentfd);
  close(rootfd);
}

int main(int argc, char **argv) {
  if (argc == 4 && strcmp(argv[1], "write-file") == 0) {
    write_file_from_stdin(argv[2], argv[3], 1, 1);
    return 0;
  }
  if (argc == 4 && strcmp(argv[1], "write-new-file") == 0) {
    write_file_from_stdin(argv[2], argv[3], 0, 1);
    return 0;
  }
  if (argc == 4 && strcmp(argv[1], "write-new-file-existing-parent") == 0) {
    write_file_from_stdin(argv[2], argv[3], 0, 0);
    return 0;
  }
  if (argc == 5 && strcmp(argv[1], "replace-tree") == 0) {
    replace_tree(argv[2], argv[3], argv[4], 1);
    return 0;
  }
  if (argc == 5 && strcmp(argv[1], "replace-tree-existing-parent") == 0) {
    replace_tree(argv[2], argv[3], argv[4], 0);
    return 0;
  }
  if (argc == 5 && strcmp(argv[1], "snapshot") == 0) {
    snapshot_item(argv[2], argv[3], argv[4]);
    return 0;
  }

  fprintf(stderr, "Usage: %s write-file <environment-root> <relative-path> < stdin\n", argv[0]);
  fprintf(stderr, "       %s write-new-file <environment-root> <relative-path> < stdin\n", argv[0]);
  fprintf(stderr, "       %s write-new-file-existing-parent <environment-root> <relative-path> < stdin\n", argv[0]);
  fprintf(stderr, "       %s replace-tree <environment-root> <relative-path> <staged-directory>\n", argv[0]);
  fprintf(stderr, "       %s replace-tree-existing-parent <environment-root> <relative-path> <staged-directory>\n", argv[0]);
  fprintf(stderr, "       %s snapshot <environment-root> <relative-path> <staged-path>\n", argv[0]);
  return 2;
}
