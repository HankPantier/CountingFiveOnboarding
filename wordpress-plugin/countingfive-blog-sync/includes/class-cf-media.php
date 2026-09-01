<?php
/**
 * Media sideload for CountingFive Blog Sync.
 *
 * WP's core media_sideload_image() can't send an Authorization header, but the
 * feed's hero images are served by an authenticated proxy — so we fetch the
 * bytes ourselves (with the bearer) and insert the attachment manually.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class CF_Blog_Sync_Media {

	/**
	 * Ensure the hero image is in the media library and set as the post's
	 * featured image. Skips re-download when the content hash is unchanged.
	 *
	 * @param int    $post_id  Target post.
	 * @param array  $hero     { url, requires_auth, alt, filename }.
	 * @param string $secret   Bearer secret (for requires_auth fetches).
	 * @return void
	 */
	public static function attach_hero( $post_id, $hero, $secret ) {
		if ( empty( $hero['url'] ) ) {
			return;
		}

		$args = array( 'timeout' => 30 );
		if ( ! empty( $hero['requires_auth'] ) && $secret !== '' ) {
			$args['headers'] = array( 'Authorization' => 'Bearer ' . $secret );
		}

		$response = wp_remote_get( $hero['url'], $args );
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return; // Non-fatal: leave the post without a featured image.
		}
		$body = wp_remote_retrieve_body( $response );
		if ( '' === $body ) {
			return;
		}

		$hash = md5( $body );
		$existing_hash = get_post_meta( $post_id, '_cf_hero_hash', true );
		$existing_thumb = get_post_thumbnail_id( $post_id );
		if ( $existing_hash === $hash && $existing_thumb ) {
			return; // Unchanged — nothing to do.
		}

		$filename = ! empty( $hero['filename'] ) ? sanitize_file_name( $hero['filename'] ) : ( 'hero-' . $post_id . '.jpg' );

		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		$upload = wp_upload_bits( $filename, null, $body );
		if ( ! empty( $upload['error'] ) ) {
			return;
		}

		$filetype = wp_check_filetype( $upload['file'], null );
		$attachment = array(
			'post_mime_type' => $filetype['type'] ? $filetype['type'] : 'image/jpeg',
			'post_title'     => sanitize_file_name( pathinfo( $filename, PATHINFO_FILENAME ) ),
			'post_content'   => '',
			'post_status'    => 'inherit',
		);
		$attach_id = wp_insert_attachment( $attachment, $upload['file'], $post_id );
		if ( is_wp_error( $attach_id ) || ! $attach_id ) {
			return;
		}
		$metadata = wp_generate_attachment_metadata( $attach_id, $upload['file'] );
		wp_update_attachment_metadata( $attach_id, $metadata );

		if ( ! empty( $hero['alt'] ) ) {
			update_post_meta( $attach_id, '_wp_attachment_image_alt', sanitize_text_field( $hero['alt'] ) );
		}

		set_post_thumbnail( $post_id, $attach_id );
		update_post_meta( $post_id, '_cf_hero_hash', $hash );
	}
}
