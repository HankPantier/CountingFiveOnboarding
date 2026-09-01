<?php
/**
 * Plugin Name: CountingFive Blog Sync
 * Description: One-way pull of published blog posts from a CountingFive feed into WordPress. Authoring/editing stays in CountingFive; this site is a publish target.
 * Version:     1.0.0
 * Author:      CountingFive
 * License:     GPL-2.0-or-later
 *
 * Isolated, removable bridge for the WordPress transition period. Polls an
 * app-served, bearer-authenticated JSON feed on WP-cron and upserts posts by
 * slug. It NEVER holds a GitHub token — only the feed URL + a shared secret.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'CF_BLOG_SYNC_VERSION', '1.0.0' );
define( 'CF_BLOG_SYNC_CRON_HOOK', 'cf_blog_sync_event' );
define( 'CF_BLOG_SYNC_OPTION', 'cf_blog_sync_settings' );
define( 'CF_BLOG_SYNC_PATH', plugin_dir_path( __FILE__ ) );

require_once CF_BLOG_SYNC_PATH . 'includes/class-cf-settings.php';
require_once CF_BLOG_SYNC_PATH . 'includes/class-cf-media.php';
require_once CF_BLOG_SYNC_PATH . 'includes/class-cf-sync.php';

/**
 * Allow the sync interval to be tuned; defaults to hourly. A custom interval is
 * registered so operators can pick "every 15 minutes" from settings.
 */
function cf_blog_sync_cron_schedules( $schedules ) {
	$schedules['cf_fifteen_minutes'] = array(
		'interval' => 15 * MINUTE_IN_SECONDS,
		'display'  => __( 'Every 15 minutes (CF Blog Sync)', 'cf-blog-sync' ),
	);
	return $schedules;
}
add_filter( 'cron_schedules', 'cf_blog_sync_cron_schedules' );

/**
 * Schedule the recurring sync on activation using the configured interval.
 */
function cf_blog_sync_activate() {
	$settings = get_option( CF_BLOG_SYNC_OPTION, array() );
	$interval = isset( $settings['interval'] ) ? $settings['interval'] : 'hourly';
	if ( ! wp_next_scheduled( CF_BLOG_SYNC_CRON_HOOK ) ) {
		wp_schedule_event( time() + MINUTE_IN_SECONDS, $interval, CF_BLOG_SYNC_CRON_HOOK );
	}
}
register_activation_hook( __FILE__, 'cf_blog_sync_activate' );

/**
 * Clear the schedule on deactivation. Synced posts are left untouched.
 */
function cf_blog_sync_deactivate() {
	$timestamp = wp_next_scheduled( CF_BLOG_SYNC_CRON_HOOK );
	if ( $timestamp ) {
		wp_unschedule_event( $timestamp, CF_BLOG_SYNC_CRON_HOOK );
	}
	wp_clear_scheduled_hook( CF_BLOG_SYNC_CRON_HOOK );
}
register_deactivation_hook( __FILE__, 'cf_blog_sync_deactivate' );

// The cron event and the "Sync now" action both run the same worker.
add_action( CF_BLOG_SYNC_CRON_HOOK, array( 'CF_Blog_Sync', 'run' ) );

// Settings page (Settings → CF Blog Sync) + "Sync now" handler.
add_action( 'admin_menu', array( 'CF_Blog_Sync_Settings', 'register_page' ) );
add_action( 'admin_init', array( 'CF_Blog_Sync_Settings', 'register_settings' ) );
add_action( 'admin_post_cf_blog_sync_now', array( 'CF_Blog_Sync_Settings', 'handle_sync_now' ) );
