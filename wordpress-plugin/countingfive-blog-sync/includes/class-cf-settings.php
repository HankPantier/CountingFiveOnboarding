<?php
/**
 * Settings screen + "Sync now" action for CountingFive Blog Sync.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class CF_Blog_Sync_Settings {

	/**
	 * Register the settings sub-page under Settings.
	 */
	public static function register_page() {
		add_options_page(
			__( 'CF Blog Sync', 'cf-blog-sync' ),
			__( 'CF Blog Sync', 'cf-blog-sync' ),
			'manage_options',
			'cf-blog-sync',
			array( __CLASS__, 'render_page' )
		);
	}

	/**
	 * Register the single option (an array) with a sanitizing callback.
	 */
	public static function register_settings() {
		register_setting(
			'cf_blog_sync',
			CF_BLOG_SYNC_OPTION,
			array( 'sanitize_callback' => array( __CLASS__, 'sanitize' ) )
		);
	}

	public static function sanitize( $input ) {
		$prev = get_option( CF_BLOG_SYNC_OPTION, array() );
		$out  = array();

		$out['feed_url'] = isset( $input['feed_url'] ) ? esc_url_raw( trim( $input['feed_url'] ) ) : '';

		// Keep the previously-saved secret if the field is submitted empty, so an
		// operator editing other fields doesn't have to re-enter it every time.
		$secret = isset( $input['secret'] ) ? trim( $input['secret'] ) : '';
		$out['secret'] = $secret !== '' ? $secret : ( isset( $prev['secret'] ) ? $prev['secret'] : '' );

		$allowed_intervals = array( 'cf_fifteen_minutes', 'hourly', 'twicedaily', 'daily' );
		$out['interval'] = isset( $input['interval'] ) && in_array( $input['interval'], $allowed_intervals, true )
			? $input['interval']
			: 'hourly';

		$out['enabled'] = ! empty( $input['enabled'] ) ? 1 : 0;

		// Re-schedule if the interval changed.
		self::reschedule( $out['interval'] );

		return $out;
	}

	private static function reschedule( $interval ) {
		$timestamp = wp_next_scheduled( CF_BLOG_SYNC_CRON_HOOK );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, CF_BLOG_SYNC_CRON_HOOK );
		}
		wp_schedule_event( time() + MINUTE_IN_SECONDS, $interval, CF_BLOG_SYNC_CRON_HOOK );
	}

	/**
	 * Handle the "Sync now" button (admin-post).
	 */
	public static function handle_sync_now() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Insufficient permissions.', 'cf-blog-sync' ) );
		}
		check_admin_referer( 'cf_blog_sync_now' );

		$result = CF_Blog_Sync::run();

		$args = array( 'page' => 'cf-blog-sync' );
		if ( is_wp_error( $result ) ) {
			$args['cf_sync_error'] = rawurlencode( $result->get_error_message() );
		} else {
			$args['cf_sync_done'] = 1;
			$args['cf_created']   = isset( $result['created'] ) ? (int) $result['created'] : 0;
			$args['cf_updated']   = isset( $result['updated'] ) ? (int) $result['updated'] : 0;
			$args['cf_drafted']   = isset( $result['drafted'] ) ? (int) $result['drafted'] : 0;
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'options-general.php' ) ) );
		exit;
	}

	public static function render_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$settings = get_option( CF_BLOG_SYNC_OPTION, array() );
		$feed_url = isset( $settings['feed_url'] ) ? $settings['feed_url'] : '';
		$interval = isset( $settings['interval'] ) ? $settings['interval'] : 'hourly';
		$enabled  = ! empty( $settings['enabled'] );
		$has_secret = ! empty( $settings['secret'] );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'CountingFive Blog Sync', 'cf-blog-sync' ); ?></h1>

			<?php if ( isset( $_GET['cf_sync_done'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p>
					<?php
					printf(
						/* translators: 1: created, 2: updated, 3: drafted */
						esc_html__( 'Sync complete — %1$d created, %2$d updated, %3$d drafted.', 'cf-blog-sync' ),
						isset( $_GET['cf_created'] ) ? (int) $_GET['cf_created'] : 0,
						isset( $_GET['cf_updated'] ) ? (int) $_GET['cf_updated'] : 0,
						isset( $_GET['cf_drafted'] ) ? (int) $_GET['cf_drafted'] : 0
					);
					?>
				</p></div>
			<?php endif; ?>

			<?php if ( isset( $_GET['cf_sync_error'] ) ) : ?>
				<div class="notice notice-error is-dismissible"><p>
					<?php echo esc_html( sanitize_text_field( wp_unslash( rawurldecode( $_GET['cf_sync_error'] ) ) ) ); ?>
				</p></div>
			<?php endif; ?>

			<form method="post" action="options.php">
				<?php settings_fields( 'cf_blog_sync' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="cf_feed_url"><?php esc_html_e( 'Feed URL', 'cf-blog-sync' ); ?></label></th>
						<td>
							<input name="<?php echo esc_attr( CF_BLOG_SYNC_OPTION ); ?>[feed_url]" id="cf_feed_url" type="url"
								class="regular-text" value="<?php echo esc_attr( $feed_url ); ?>"
								placeholder="https://app.example.com/api/wp-feed/your-site" />
							<p class="description"><?php esc_html_e( 'The CountingFive feed endpoint for this site.', 'cf-blog-sync' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="cf_secret"><?php esc_html_e( 'Shared secret', 'cf-blog-sync' ); ?></label></th>
						<td>
							<input name="<?php echo esc_attr( CF_BLOG_SYNC_OPTION ); ?>[secret]" id="cf_secret" type="password"
								class="regular-text" value="" autocomplete="new-password"
								placeholder="<?php echo $has_secret ? esc_attr__( '•••••• (saved — leave blank to keep)', 'cf-blog-sync' ) : ''; ?>" />
							<p class="description"><?php esc_html_e( 'Bearer token for the feed. Sent as Authorization: Bearer <secret>.', 'cf-blog-sync' ); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="cf_interval"><?php esc_html_e( 'Sync interval', 'cf-blog-sync' ); ?></label></th>
						<td>
							<select name="<?php echo esc_attr( CF_BLOG_SYNC_OPTION ); ?>[interval]" id="cf_interval">
								<option value="cf_fifteen_minutes" <?php selected( $interval, 'cf_fifteen_minutes' ); ?>><?php esc_html_e( 'Every 15 minutes', 'cf-blog-sync' ); ?></option>
								<option value="hourly" <?php selected( $interval, 'hourly' ); ?>><?php esc_html_e( 'Hourly', 'cf-blog-sync' ); ?></option>
								<option value="twicedaily" <?php selected( $interval, 'twicedaily' ); ?>><?php esc_html_e( 'Twice daily', 'cf-blog-sync' ); ?></option>
								<option value="daily" <?php selected( $interval, 'daily' ); ?>><?php esc_html_e( 'Daily', 'cf-blog-sync' ); ?></option>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Enabled', 'cf-blog-sync' ); ?></th>
						<td>
							<label>
								<input name="<?php echo esc_attr( CF_BLOG_SYNC_OPTION ); ?>[enabled]" type="checkbox" value="1" <?php checked( $enabled ); ?> />
								<?php esc_html_e( 'Run scheduled syncs', 'cf-blog-sync' ); ?>
							</label>
							<p class="description"><?php esc_html_e( 'Uncheck to pause syncing without deleting settings.', 'cf-blog-sync' ); ?></p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr />
			<h2><?php esc_html_e( 'Manual sync', 'cf-blog-sync' ); ?></h2>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="cf_blog_sync_now" />
				<?php wp_nonce_field( 'cf_blog_sync_now' ); ?>
				<?php submit_button( __( 'Sync now', 'cf-blog-sync' ), 'secondary', 'submit', false ); ?>
			</form>
		</div>
		<?php
	}
}
